FROM oven/bun:1-alpine

WORKDIR /app

COPY package.json ./
RUN bun install --production --frozen-lockfile || bun install --production

COPY src ./src
# One-off ops scripts (run via `docker exec`, not by the app itself) —
# e.g. scripts/normalize-payout-dates.ts.
COPY scripts/normalize-payout-dates.ts ./scripts/
COPY KBIZTemplateUploadPayroll.xlsx ./
COPY KBIZTemplateAddPayrollAccount.xlsx ./

ENV PORT=3000
EXPOSE 3000

CMD ["bun", "run", "src/index.ts"]
