FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:24-bookworm-slim
# CA-Zertifikate für die native Copilot-Runtime (HTTPS zu GitHub)
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    NODE_OPTIONS=--disable-warning=ExperimentalWarning
COPY --from=build /app /app
VOLUME /data
EXPOSE 8080
CMD ["npm", "start"]
