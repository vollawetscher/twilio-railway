# ===== Dockerfile =====
FROM node:20

# Set working directory
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --production

# Copy rest of the app
COPY . .

# Expose port
EXPOSE 8080

# Start app
CMD ["node", "index.js"]