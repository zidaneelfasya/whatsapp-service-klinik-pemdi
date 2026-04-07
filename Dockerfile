FROM node:18-alpine

# Install Chromium and dependencies
RUN apk add --no-cache \
      chromium \
      nss \
      freetype \
      freetype-dev \
      harfbuzz \
      ca-certificates \
      ttf-freefont

# Beritahu Puppeteer untuk menggunakan Chromium bawaan dari OS Alpine
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Set working directory di dalam container
WORKDIR /usr/src/app

# Salin package.json & package-lock.json
COPY package*.json ./

# Install dependensi
RUN npm install

# Salin semua kode ke dalam container
COPY . .

# Expose port dari .env (default: 5000)
EXPOSE 5000

# Perintah untuk menjalankan container
CMD ["node", "index.js"]
