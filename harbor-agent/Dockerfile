FROM node:20-bookworm-slim

# Install system deps
RUN apt-get update -qq && \
    apt-get install -y -qq curl unzip git python3 python3-pip && \
    rm -rf /var/lib/apt/lists/*

# Install Bun (ARM64 native)
RUN curl -fsSL https://github.com/oven-sh/bun/releases/latest/download/bun-linux-aarch64.zip \
    -o /tmp/bun.zip && \
    unzip -o /tmp/bun.zip -d /tmp && \
    mv /tmp/bun-*/bun /usr/local/bin/bun && \
    chmod +x /usr/local/bin/bun && \
    rm -rf /tmp/bun.zip /tmp/bun-*

WORKDIR /app/salmon-loop
COPY . /app/salmon-loop/

RUN bun install

CMD ["sleep", "infinity"]
