FROM node:20-alpine AS builder

WORKDIR /app

# Установка зависимостей для Prisma (openssl)
RUN apk add --no-cache openssl

# Copy package files
COPY package*.json ./

# Install all dependencies for build
RUN npm ci

# Copy prisma schema
COPY prisma ./prisma/

# Generate Prisma Client
RUN npx prisma generate

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Production stage
FROM node:20-alpine

WORKDIR /app

# Установка зависимостей для Prisma в production (openssl + ca-certificates)
RUN apk add --no-cache openssl openssl-dev ca-certificates

# Copy package files
COPY package*.json ./

# Install ONLY production dependencies
RUN npm install --omit=dev

# Copy prisma schema and generate client
COPY prisma ./prisma/
RUN npx prisma generate

# Copy built files from builder
COPY --from=builder /app/dist ./dist

# Copy entrypoint script
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

# Expose port for health check
EXPOSE 4000

# Health check endpoint
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s \
  CMD node -e "require('http').get('http://localhost:4000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start server with entrypoint
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["npm", "start"]
