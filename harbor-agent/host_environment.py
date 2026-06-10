"""
Host-native Harbor environment.

Runs commands directly on the host machine instead of inside a Docker container.
Useful for ARM64 hosts where QEMU x86_64 emulation is broken.
"""

import asyncio
import os
import shutil
import tempfile
from pathlib import Path

from harbor.environments.base import BaseEnvironment
from harbor.environments.capabilities import EnvironmentCapabilities
from harbor.models.agent.context import ExecResult


class HostEnvironment(BaseEnvironment):
    """Environment that runs commands on the host machine."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._workspace: str | None = None
        self._env_vars: dict[str, str] = {}

    @staticmethod
    def type() -> str:
        return "host"

    async def start(self) -> None:
        self._workspace = tempfile.mkdtemp(prefix="harbor-host-")
        # Copy task files to workspace if available
        task_dir = getattr(self, '_task_dir', None)
        if task_dir and os.path.isdir(task_dir):
            shutil.copytree(task_dir, self._workspace, dirs_exist_ok=True)

    async def stop(self) -> None:
        if self._workspace and os.path.isdir(self._workspace):
            shutil.rmtree(self._workspace, ignore_errors=True)

    async def exec(
        self,
        command: str,
        user: str | int | None = None,
        env: dict[str, str] | None = None,
        cwd: str | None = None,
        timeout_sec: int | None = None,
    ) -> ExecResult:
        merged_env = {**os.environ, **(self._env_vars or {}), **(env or {})}
        work_dir = cwd or self._workspace

        proc = await asyncio.create_subprocess_shell(
            command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=merged_env,
            cwd=work_dir,
        )

        try:
            stdout_bytes, stderr_bytes = await asyncio.wait_for(
                proc.communicate(),
                timeout=timeout_sec,
            )
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            return ExecResult(
                stdout="",
                stderr=f"Command timed out after {timeout_sec}s",
                return_code=-1,
            )

        return ExecResult(
            stdout=stdout_bytes.decode("utf-8", errors="replace"),
            stderr=stderr_bytes.decode("utf-8", errors="replace"),
            return_code=proc.returncode or 0,
        )

    async def upload_file(self, source_path: str, target_path: str) -> None:
        if self._workspace:
            dest = os.path.join(self._workspace, target_path)
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            shutil.copy2(source_path, dest)

    async def upload_dir(self, source_dir: str, target_dir: str) -> None:
        if self._workspace:
            dest = os.path.join(self._workspace, target_dir)
            shutil.copytree(source_dir, dest, dirs_exist_ok=True)

    async def download_file(self, source_path: str, target_path: str) -> None:
        if self._workspace:
            src = os.path.join(self._workspace, source_path)
            os.makedirs(os.path.dirname(target_path), exist_ok=True)
            shutil.copy2(src, target_path)

    async def download_dir(self, source_dir: str, target_dir: str) -> None:
        if self._workspace:
            src = os.path.join(self._workspace, source_dir)
            shutil.copytree(src, target_dir, dirs_exist_ok=True)
