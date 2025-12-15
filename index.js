require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const port = process.env.PORT || 3000;
const app = express();

// CORS
const corsOptions = {
  origin: ["http://localhost:5173"],
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

const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader)
    return res.status(401).json({ message: "No token provided" });
  const token = authHeader.split(" ")[1];
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) return res.status(403).json({ message: "Invalid token" });
    req.user = decoded;
    next();
  });
};

const verifyAdmin = (req, res, next) => {
  const user = req.user;
  if (user.role !== "admin") {
    return res.status(403).json({ message: "Forbidden: Admins only" });
  }
  next();
};

const verifyModerator = (req, res, next) => {
  const user = req.user;
  if (user.role !== "moderator") {
    return res.status(403).json({ message: "Forbidden: Moderators only" });
  }
  next();
};

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
    app.get("/users", verifyToken, async (req, res) => {
      try {
        const result = await usersCollection.find().toArray();
        res.json(result);
      } catch (error) {
        res.status(500).json({ error: "Failed to fetch users" });
      }
    });

    app.get("/users/:email", verifyToken, async (req, res) => {
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

    app.get("/users/role/:email", verifyToken, async (req, res) => {
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
        if (!user || !user.email) {
          return res.status(400).json({ error: "Email is required" });
        }
        const email = user.email.toLowerCase();

        // Check if user exists
        const existingUser = await usersCollection.findOne({ email });

        if (existingUser) {
          const result = await usersCollection.updateOne(
            { email },
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
        // Create new user
        const newUser = {
          ...user,
          email,
          role: user.role || "student",
          createdAt: new Date().toISOString(),
        };
        const result = await usersCollection.insertOne(newUser);
        res.json({ message: "User created", insertedId: result.insertedId });
      } catch (error) {
        console.error("Failed to save user:", error);
        res.status(500).json({ error: "Failed to save user" });
      }
    });

    app.patch("/users/:email", verifyToken, async (req, res) => {
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

    app.patch("/users/:id/role", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const { role } = req.body;
      const result = await usersCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { role } }
      );
      res.json(result);
    });

    app.delete("/users/:id", verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const result = await usersCollection.deleteOne({ _id: new ObjectId(id) });
      res.json(result);
    });

    /** -------------------- Scholarship Routes -------------------- **/
    app.get("/scholarships", async (req, res) => {
      const result = await scholarshipsCollection.find().toArray();
      res.json(result);
    });

    app.get("/scholarships/top", async (req, res) => {
      const limit = parseInt(req.query.limit) || 6;
      const result = await scholarshipsCollection
        .find()
        .sort({ applicationFees: 1 })
        .limit(limit)
        .toArray();
      res.json(result);
    });

    app.get("/scholarships/:id", async (req, res) => {
      const id = req.params.id;
      const result = await scholarshipsCollection.findOne({
        _id: new ObjectId(id),
      });
      res.json(result);
    });

    app.post("/scholarships", verifyToken, verifyAdmin, async (req, res) => {
      const result = await scholarshipsCollection.insertOne(req.body);
      res.json({ insertedId: result.insertedId });
    });

    app.patch("/scholarships/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const result = await scholarshipsCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: req.body }
      );
      res.json(result);
    });

    app.delete("/scholarships/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const result = await scholarshipsCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.json(result);
    });

    /** -------------------- Application Routes -------------------- **/

    app.get("/application", verifyToken, async (req, res) => {
      try {
        const result = await applicationCollection.find().toArray();
        res.json(result);
      } catch (error) {
        res.status(500).json({ error: "Failed to fetch applications" });
      }
    });

    app.post("/application", verifyToken, async (req, res) => {
      const application = {
        ...req.body,
        appliedAt: new Date().toISOString(),
        applicationStatus: req.body.applicationStatus || "pending",
        paymentStatus: "unpaid", // last added thing
        createdAt: new Date().toISOString(),
      };

      const result = await applicationCollection.insertOne(application);
      res.json({ insertedId: result.insertedId });
    });

    app.get("/application/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const result = await applicationCollection.findOne({
        _id: new ObjectId(id),
      });
      res.json(result);
    });

    app.get("/application/user/:email", verifyToken, async (req, res) => {
      try {
        const email = req.params.email;
        const result = await applicationCollection
          .find({ userEmail: email })
          .toArray();
        res.json(result);
      } catch (error) {
        res.status(500).json({ error: "Failed to fetch user applications" });
      }
    });

    app.get("/application/recent", verifyToken, async (req, res) => {
      try {
        const { email, limit } = req.query;
        const limitNum = limit ? Math.min(parseInt(limit), 100) : 5;

        const result = await applicationCollection
          .find({ userEmail: email })
          .sort({ appliedAt: -1 })
          .limit(limitNum)
          .toArray();

        res.json(result);
      } catch (error) {
        res.status(500).json({ error: "Failed to fetch recent activities" });
      }
    });

    app.get("/my-application", verifyToken, async (req, res) => {
      const result = await applicationCollection.find().toArray();
      res.send(result);
    });

    app.get("/manage-application/:email", verifyToken, verifyModerator, async (req, res) => {
      const result = await applicationCollection.find().toArray();
      res.send(result);
    });

    app.patch("/application/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const result = await applicationCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: req.body }
      );
      res.json(result);
    });

    app.patch("/application/:id/status", verifyToken, verifyModerator, async (req, res) => {
      const id = req.params.id;
      const { status } = req.body;
      const result = await applicationCollection.updateOne(
        { _id: new ObjectId(id) },
        {
          $set: {
            applicationStatus: status,
            updatedAt: new Date().toISOString(),
          },
        }
      );
      res.json({ success: true, modifiedCount: result.modifiedCount });
    });

    app.patch("/application/:id/feedback", verifyToken, verifyModerator, async (req, res) => {
      const id = req.params.id;
      const { feedback } = req.body;
      const result = await applicationCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { feedback, updatedAt: new Date().toISOString() } }
      );
      res.json({ success: true, result });
    });

    app.delete("/application/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const result = await applicationCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.json(result);
    });

    /** -------------------- Dashboard Stats -------------------- **/
    app.get("/application/dashboard/status", verifyToken, verifyAdmin, async (req, res) => {
      try {
        const { email } = req.query;
        const user = await usersCollection.findOne({ email });
        const isAdminOrModerator =
          user && (user.role === "admin" || user.role === "moderator");

        let query = {};
        if (!isAdminOrModerator && email) query = { userEmail: email };

        const totalApplications = await applicationCollection.countDocuments(
          query
        );
        const stats = await applicationCollection
          .aggregate([
            { $match: query },
            {
              $group: {
                _id: null,
                total: { $sum: 1 },
                pending: {
                  $sum: {
                    $cond: [{ $eq: ["$applicationStatus", "pending"] }, 1, 0],
                  },
                },
                processing: {
                  $sum: {
                    $cond: [
                      { $eq: ["$applicationStatus", "processing"] },
                      1,
                      0,
                    ],
                  },
                },

                completed: {
                  $sum: {
                    $cond: [{ $eq: ["$applicationStatus", "completed"] }, 1, 0],
                  },
                },
                rejected: {
                  $sum: {
                    $cond: [{ $eq: ["$applicationStatus", "rejected"] }, 1, 0],
                  },
                },
              },
            },
          ])
          .toArray();

        const result = stats[0] || {
          total: 0,
          pending: 0,
          processing: 0,
          completed: 0,
          rejected: 0,
        };
        result.total = totalApplications;

        res.json({
          totalApplications: result.total,
          pending: result.pending,
          processing: result.processing,
          completed: result.completed,
          rejected: result.rejected,
        });
      } catch (error) {
        res.status(500).json({ error: "Failed to fetch stats" });
      }
    });

    /** -------------------- Review Routes -------------------- **/

    app.get("/reviews", verifyToken, async (req, res) => {
      const result = await reviewsCollection
        .find({})
        .sort({ reviewDate: -1 })
        .toArray();
      res.json(result);
    });

    app.get("/reviews/scholarship/:scholarshipId", verifyToken, async (req, res) => {
        const scholarshipId = req.params.scholarshipId;
        const result = await reviewsCollection
          .find({ scholarshipId })
          .sort({ reviewDate: -1 })
          .toArray();
        res.json(result);
      }
    );

    app.get("/reviews/user/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const result = await reviewsCollection
        .find({ userEmail: email })
        .toArray();
      res.json(result);
    });

    app.patch("/application/:id/review", verifyToken, async (req, res) => {
      const applicationId = req.params.id;
      const { rating, comment } = req.body;

      const application = await applicationCollection.findOne({
        _id: new ObjectId(applicationId),
      });
      const scholarship = await scholarshipsCollection.findOne({
        _id: new ObjectId(application.scholarshipId),
      });

      const userEmail = application.applicantEmail || application.userEmail;
      const userName = application.applicantName || application.userName;
      const userPhoto = application.applicantPhoto || application.userPhoto;

      const existingReview = await reviewsCollection.findOne({
        scholarshipId: application.scholarshipId,
        userEmail,
      });

      const reviewData = {
        scholarshipId: application.scholarshipId,
        scholarshipName: scholarship.scholarshipName,
        universityName: scholarship.universityName,
        userEmail,
        userName: userName || "Anonymous User",
        userPhoto: userPhoto || null,
        ratingPoint: parseInt(rating),
        reviewComment: comment.trim(),
        reviewDate: new Date(),
      };

      let result;
      if (existingReview) {
        result = await reviewsCollection.updateOne(
          { _id: existingReview._id },
          { $set: reviewData }
        );
      } else {
        result = await reviewsCollection.insertOne(reviewData);
      }

      await applicationCollection.updateOne(
        { _id: new ObjectId(applicationId) },
        { $set: { reviewed: true } }
      );

      res.json({ success: true, result });
    });

    app.patch("/reviews/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const { reviewComment, ratingPoint } = req.body;
      const result = await reviewsCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { reviewComment, ratingPoint, reviewDate: new Date() } }
      );
      res.send(result);
    });

    app.delete("/reviews/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const result = await reviewsCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.json(result);
    });

    console.log("All routes configured successfully!");
  } catch (error) {
    console.error("MongoDB connection failed:", error);
  }
}

run().catch(console.dir);

/** -------------------- Root & 404 -------------------- **/
app.get("/", (req, res) => res.send("Scholar Stream Server is okay!"));
app.use((req, res) => res.status(404).json({ error: "Route not found" }));

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
