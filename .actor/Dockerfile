# Stage 1: compile TypeScript (dev deps live only here).
FROM apify/actor-node-playwright-chrome:22 AS builder
COPY --chown=myuser package*.json tsconfig.json ./
RUN npm ci --include=dev --no-audit --no-fund
COPY --chown=myuser src ./src
RUN npm run build

# Stage 2: runtime. Chrome-only Playwright image; "playwright": "*" resolves to
# the version whose browsers are preinstalled in the image.
FROM apify/actor-node-playwright-chrome:22
COPY --chown=myuser package*.json ./
RUN npm ci --omit=dev --omit=optional --no-audit --no-fund && rm -rf ~/.npm
COPY --chown=myuser --from=builder /home/myuser/dist ./dist
CMD ["node", "dist/main.js"]
