require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const port = process.env.PORT || 3000;
const app = express();

// CORS
const corsOptions = {
  origin: ["http://localhost:5173", "http://127.0.0.1:5173"],
  credentials: true,
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

app.use(cors(corsOptions));
app.use(express.json());

const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    const db = client.db("scholar-stream-client");
    const scholarshipsCollection = db.collection("scholarships");
    const usersCollection = db.collection("users");
    const applicationCollection = db.collection("application");
    const reviewsCollection = db.collection("reviews");

    console.log("MongoDB connected successfully!");


        /** -------------------- Stripe Routes -------------------- **/
    app.post("/create-checkout-session", async (req, res) => {
      try {
        const {
          applicationId,
          scholarshipName,
          universityName,
          degree,
          totalAmount,
          customer,
        } = req.body;

        const session = await stripe.checkout.sessions.create({
          payment_method_types: ["card"],
          line_items: [
            {
              price_data: {
                currency: "usd",
                product_data: {
                  name: `${scholarshipName} - ${universityName}`,
                  description: `${degree} Degree Application`,
                  images: ["https://i.ibb.co/YpjwXXP/scholarship-icon.png"],
                },
                unit_amount: Math.round(totalAmount * 100),
              },
              quantity: 1,
            },
          ],
          mode: "payment",
          success_url: `${process.env.CLIENT_URL}/payment-success?session_id={CHECKOUT_SESSION_ID}&application_id=${applicationId}`,
          cancel_url: `${process.env.CLIENT_URL}/payment-failed?application_id=${applicationId}`,
          customer_email: customer.email,
          metadata: {
            applicationId,
            scholarshipName,
            universityName,
            customerName: customer.name,
            customerEmail: customer.email,
          },
        });

        res.json({ url: session.url });
      } catch (error) {
        console.error("Stripe error:", error);
        res.status(500).json({ error: error.message });
      }
    });


        /** -------------------- User Routes -------------------- **/
    app.get("/users", async (req, res) => {
      try {
        const result = await usersCollection.find().toArray();
        res.json(result);
      } catch (error) {
        res.status(500).json({ error: "Failed to fetch users" });
      }
    });

    app.get("/users/:email", async (req, res) => {
      try {
        const email = req.params.email;
        const user = await usersCollection.findOne({
          email: email.toLowerCase(),
        });
        if (!user) return res.status(404).json({ message: "User not found" });
        res.json(user);
      } catch (error) {
        res.status(500).json({ error: "Failed to fetch user" });
      }
    });

    app.get("/users/role/:email", async (req, res) => {
      try {
        const email = req.params.email;
        const user = await usersCollection.findOne(
          { email: email.toLowerCase() },
          { projection: { role: 1, name: 1, photoURL: 1 } }
        );
        res.json({ role: user?.role || "student" });
      } catch (error) {
        res.status(500).json({ error: "Failed to fetch user role" });
      }
    });

        app.post("/users", async (req, res) => {
      try {
        const user = req.body;
        const existingUser = await usersCollection.findOne({
          email: user.email,
        });
        if (existingUser) {
          const result = await usersCollection.updateOne(
            { email: user.email },
            {
              $set: {
                name: user.name,
                photoURL: user.photoURL,
                updatedAt: new Date().toISOString(),
              },
            }
          );
          return res.json({
            message: "User updated",
            acknowledged: result.acknowledged,
          });
        }
        const newUser = {
          ...user,
          role: user.role || "student",
          createdAt: new Date().toISOString(),
        };
        const result = await usersCollection.insertOne(newUser);
        res.json({ message: "User created", insertedId: result.insertedId });
      } catch (error) {
        res.status(500).json({ error: "Failed to save user" });
      }
    });

    app.patch("/users/:email", async (req, res) => {
      try {
        const email = req.params.email;
        const { displayName, photoURL } = req.body;
        const updateFields = { updatedAt: new Date().toISOString() };
        if (displayName) updateFields.name = displayName;
        if (photoURL) updateFields.photoURL = photoURL;

        const result = await usersCollection.updateOne(
          { email: email.toLowerCase() },
          { $set: updateFields }
        );
        res.json({
          success: true,
          message: "Profile updated",
          modifiedCount: result.modifiedCount,
        });
      } catch (error) {
        res.status(500).json({ error: "Failed to update profile" });
      }
    });

    app.patch("/users/:id/role", async (req, res) => {
      const id = req.params.id;
      const { role } = req.body;
      const result = await usersCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { role } }
      );
      res.json(result);
    });

    app.delete("/users/:id", async (req, res) => {
      const id = req.params.id;
      const result = await usersCollection.deleteOne({ _id: new ObjectId(id) });
      res.json(result);
    });
