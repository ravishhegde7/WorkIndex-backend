const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Test route (very important for Railway)
app.get("/", (req, res) => {
  res.status(200).json({
    status: "OK",
    message: "WorkIndex backend running 🚀"
  });
});

// Port for Railway
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});
