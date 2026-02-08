import "dotenv/config";
import express from "express";
import http from "http";
import cors from "cors";
import { initSocket } from "./services/socket.js";
import { initDB } from "./db/db.js";
import { initRedis } from "./services/redis.js";
import authRoutes from "./routes/auth.js";
import calendarRoutes from "./routes/calendar.js";
import availabilityRoutes from "./routes/availability.js";
import groupRoutes from "./routes/groups.js";

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());

app.use("/auth", authRoutes);
app.use("/calendar", calendarRoutes);
app.use("/availability", availabilityRoutes);
app.use("/groups", groupRoutes);

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Initialize database, Redis, and start server
const startServer = async () => {
  try {
    // Initialize database
    await initDB();
    console.log("Database initialized");
    
    // Initialize Redis (optional - app can work without it)
    await initRedis();
    console.log("Redis initialized (if available)");
    
    // Initialize Socket.IO
    initSocket(server);
    console.log("Socket.IO initialized");
    
    server.listen(3001, () => {
      console.log("Backend running on http://localhost:3001");
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
};

startServer();
