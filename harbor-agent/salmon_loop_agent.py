"""
Harbor agent adapter for salmon-loop.

Usage:
    harbor run \
      --agent-import-path /path/to/salmon_loop_agent.py:SalmonLoopAgent \
      -d terminal-bench@2.0 \
      -m anthropic/claude-sonnet-4-20250514
"""

import json
import os
import platform
import re
from pathlib import Path

from harbor.agents.installed.base import BaseInstalledAgent
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext


class SalmonLoopAgent(BaseInstalledAgent):
    """Harbor agent that runs salmon-loop inside the evaluation environment."""

    def __init__(self, *args, salmon_loop_path: str | None = None, **kwargs):
        super().__init__(*args, **kwargs)
        self._salmon_loop_path = salmon_loop_path or os.environ.get(
            "SALMON_LOOP_PATH", os.getcwd()
        )

    @staticmethod
    def name() -> str:
        return "salmon-loop"

    def version(self) -> str | None:
        pkg_json = Path(self._salmon_loop_path) / "package.json"
        if pkg_json.exists():
            try:
                return json.loads(pkg_json.read_text()).get("version")
            except (json.JSONDecodeError, KeyError):
                pass
        return "unknown"

    async def install(self, environment: BaseEnvironment) -> None:
        """Install Bun runtime and salmon-loop in the environment."""
        # Install system dependencies (unzip required by Bun installer)
        await self.exec_as_root(
            environment,
            command="apt-get update -qq && apt-get install -y -qq unzip curl >/dev/null 2>&1 || "
            "apk add --no-cache unzip curl 2>/dev/null || true",
        )

        # Install Bun (force host architecture for QEMU-emulated containers)
        host_arch = platform.machine()
        if host_arch in ("aarch64", "arm64"):
            bun_platform = "linux-aarch64"
        else:
            bun_platform = "linux-x64"
        await self.exec_as_agent(
            environment,
            command=(
                f"curl -fsSL https://github.com/oven-sh/bun/releases/latest/download/bun-{bun_platform}.zip "
                "-o /tmp/bun.zip && "
                "unzip -o /tmp/bun.zip -d /tmp && "
                "mkdir -p ~/.bun/bin && "
                "mv /tmp/bun-*/bun ~/.bun/bin/bun && "
                "chmod +x ~/.bun/bin/bun && "
                "rm -rf /tmp/bun.zip /tmp/bun-*"
            ),
        )

        # Copy salmon-loop project into the container
        await environment.upload_dir(self._salmon_loop_path, "/app/salmon-loop")

        # Install dependencies
        await self.exec_as_agent(
            environment,
            command="cd /app/salmon-loop && ~/.bun/bin/bun install",
        )

    async def run(
        self,
        instruction: str,
        environment: BaseEnvironment,
        context: AgentContext,
    ) -> None:
        """Run salmon-loop with the task instruction."""
        escaped_instruction = json.dumps(instruction)

        command = (
            "cd /app/salmon-loop && "
            "~/.bun/bin/bun run src/cli/index.ts run "
            "-r /workspace "
            f"-i {escaped_instruction} "
            "--output-format json "
            "--permission-mode yolo "
            "2>&1 | tee /logs/agent/salmon-loop.log"
        )

        result = await self.exec_as_agent(
            environment,
            command=command,
            timeout_sec=600,
        )

        # Parse token usage from salmon-loop output if available
        stdout = result.stdout or ""
        self._parse_token_usage(stdout, context)

    def _parse_token_usage(self, output: str, context: AgentContext) -> None:
        """Extract token usage from salmon-loop JSON output."""
        for line in reversed(output.strip().split("\n")):
            line = line.strip()
            if not line.startswith("{"):
                continue
            try:
                data = json.loads(line)
            except json.JSONDecodeError:
                continue

            usage = data.get("usage")
            if isinstance(usage, dict):
                context.n_input_tokens = usage.get("inputTokens")
                context.n_output_tokens = usage.get("outputTokens")
            return
