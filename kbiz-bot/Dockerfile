# The playwright version in kbiz-bot/package.json MUST be pinned exactly to
# this base image tag — the image ships that version's browsers, and a newer
# library refuses to launch them (bot crashloops with "Executable doesn't
# exist"). Bump both together.
FROM mcr.microsoft.com/playwright:v1.59.1-noble

# kbiz-bot lives at /app/kbiz-bot so resolve("..", "data", ...) hits /app/data,
# matching how docker-compose mounts the shared data volume into both
# payroll-form (at /app/data) and this container.
WORKDIR /app/kbiz-bot

COPY kbiz-bot/package.json ./
RUN npm install --include=dev

COPY kbiz-bot/src ./src

ENV KBIZ_HEADLESS=1
ENV QUEUE_POLL_MS=30000

# Run the queue watcher. Skip --env-file flag (compose injects env vars).
# Ctrl+C / docker stop ends it cleanly.
CMD ["node", "--import", "tsx", "src/process-queue.ts", "--watch"]
