import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

const token = jwt.sign({ id: "user-1", name: "Admin", role: "admin" }, env.JWT_SECRET);
console.log("TOKEN:", token);

async function check() {
  try {
    const res = await fetch(`http://localhost:${env.API_PORT}/api/whatsapp/status`, {
      headers: { "Authorization": `Bearer ${token}` }
    });
    const data = await res.json();
    console.log("REMOTE_STATUS:", JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("FETCH_ERROR:", err);
  }
}

check();
