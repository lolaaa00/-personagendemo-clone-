FROM node:22-alpine

WORKDIR /app

# Copy package requirements
COPY package*.json ./

# Install production dependencies
RUN npm ci --omit=dev

# Copy server logic
COPY . .

# Expose port internally inside Easypanel's virtual Docker network
EXPOSE 8000

ENV PORT=8000
ENV NODE_ENV=production

CMD ["node", "server.js"]
