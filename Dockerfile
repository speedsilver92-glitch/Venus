FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
RUN npm install
COPY client ./client
COPY server ./server
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
COPY package.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
RUN npm install --omit=dev --workspace server
COPY server ./server
COPY --from=builder /app/client/dist ./client/dist
RUN mkdir -p server/uploads server/data
EXPOSE 3001
CMD ["npm", "start"]
