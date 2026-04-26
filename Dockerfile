FROM oven/bun:1-alpine

WORKDIR /app

COPY package.json ./
RUN bun install --production --frozen-lockfile || bun install --production

COPY src ./src
COPY KBIZTemplateUploadPayroll.xlsx ./
COPY KBIZTemplateAddPayrollAccount.xlsx ./

ENV PORT=3000
EXPOSE 3000

CMD ["bun", "run", "src/index.ts"]
