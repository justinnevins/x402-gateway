FROM node:22-slim AS builder

# Update npm to latest (handles newer package version formats)
RUN npm install -g npm@11

WORKDIR /app

COPY package.json ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

# Production image
FROM node:22-slim

RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

RUN npm install -g npm@11

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY --from=builder /app/dist ./dist

EXPOSE 3402

CMD ["node", "dist/index.js"]
