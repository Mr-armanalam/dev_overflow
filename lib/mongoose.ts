import mongoose from "mongoose";

let isConnected: boolean = false;

export const connectToDatabase = async () => {
  mongoose.set("strictQuery", true); // only allow query that match with schema

  // Server-only variable: never use a NEXT_PUBLIC_* variable for the
  // database URI — NEXT_PUBLIC_* values are inlined into the client bundle.
  const mongodbUrl = process.env.MONGODB_URL;

  if (!mongodbUrl) {
    throw new Error(
      "Missing MONGODB_URL environment variable. See .env.example.",
    );
  }

  if (isConnected && mongoose.connection.readyState === 1) {
    return;
  }

  // A previous connection may have dropped; allow a fresh connect attempt.
  isConnected = false;

  try {
    await mongoose.connect(mongodbUrl, {
      dbName: "Stack_Overflow",
    });
    isConnected = true;
  } catch (error) {
    // Never kill the whole server on a transient DB failure; let the
    // caller handle the error and allow a later retry.
    isConnected = false;
    console.error("Failed to connect to MongoDB", error);
    throw error;
  }
};
