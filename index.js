// server.js
const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const jwt = require('jsonwebtoken')
const admin = require("firebase-admin");

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());


const decodedKey = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf8');
const serviceAccount = JSON.parse(decodedKey);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});


// MongoDB Connection


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.pdx5h.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {

        // await client.connect();

        const parcelCollection = client.db('parcelDB').collection('parcels')
        const paymentCollection = client.db('parcelDB').collection('payments')
        const usersCollection = client.db('parcelDB').collection('users')
        const riderCollection = client.db('parcelDB').collection('riders')
        const trackingsCollection = client.db('parcelDB').collection('trackings')

        // middle wire custom
        const verifyToken = async (req, res, next) => {
            const authHeader = req.headers['authorization'];
            if (!authHeader) {
                return res.status(401).send({ message: "Unauthorized" });
            }

            const token = authHeader.split(' ')[1];
            if (!token) {
                return res.status(401).send({ message: "Unauthorized" });
            }

            try {
                const decoded = await admin.auth().verifyIdToken(token);
                req.decoded = decoded;
                next();
            } catch (error) {
                return res.status(403).send({ message: "Forbidden access" });
            }
        };

        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email }
            const user = await usersCollection.findOne(query);
            if (!user || user.role !== 'admin') {
                return res.status(403).send({ message: 'forbidden access' })
            }
            next();
        }
        // rider verification
        const verifyRider = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email }
            const user = await usersCollection.findOne(query);
            if (!user || user.role !== 'rider') {
                return res.status(403).send({ message: 'forbidden access' })
            }
            next();
        }

        app.post('/users', async (req, res) => {
            const user = req.body
            const isExist = await usersCollection.findOne({ email: user.email })

            if (isExist) {
                return res.status(200).send({ message: 'users already exist' })
            }

            const result = await usersCollection.insertOne(user)
            res.send(result)
        })
        // GET: Get user role by email
        app.get('/users/:email/role', async (req, res) => {
            try {
                const email = req.params.email;

                if (!email) {
                    return res.status(400).send({ message: 'Email is required' });
                }

                const user = await usersCollection.findOne({ email });

                if (!user) {
                    return res.status(404).send({ message: 'User not found' });
                }

                res.send({ role: user.role || 'user' });
            } catch (error) {
                console.error('Error getting user role:', error);
                res.status(500).send({ message: 'Failed to get role' });
            }
        });

        app.get("/users/search", async (req, res) => {
            const emailQuery = req.query.email;
            if (!emailQuery) {
                return res.status(400).send({ message: "Missing email query" });
            }

            const regex = new RegExp(emailQuery, "i"); // case-insensitive partial match

            try {
                const users = await usersCollection
                    .find({ email: { $regex: regex } })
                    // .project({ email: 1, createdAt: 1, role: 1 })
                    .limit(10)
                    .toArray();
                res.send(users);
            } catch (error) {
                console.error("Error searching users", error);
                res.status(500).send({ message: "Error searching users" });
            }
        });

        app.patch("/users/:id/role", async (req, res) => {
            const { id } = req.params;
            const { role } = req.body;

            if (!["admin", "user"].includes(role)) {
                return res.status(400).send({ message: "Invalid role" });
            }

            try {
                const result = await usersCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { role } }
                );
                res.send({ message: `User role updated to ${role}`, result });
            } catch (error) {
                console.error("Error updating user role", error);
                res.status(500).send({ message: "Failed to update user role" });
            }
        });

        // pacels api
        app.get('/parcels/:email', verifyToken, async (req, res) => {
            try {
                const email = req.params.email;
                const query = { created_by: email }
                const result = await parcelCollection.find(query).toArray()
                res.send(result)
            } catch (error) {
                console.log('Failed to fetch parcels');
                res.status(500).send({ message: 'Failed to fetch parcels' })
            }
        })
        // GET: All parcels OR parcels by user (created_by), sorted by latest
        app.get('/parcels', async (req, res) => {
            try {
                const { email, payment_status, delivery_status } = req.query;
                let query = {}
                if (email) {
                    query = { created_by: email }
                }

                if (payment_status) {
                    query.payment_status = payment_status
                }

                if (delivery_status) {
                    query.delivery_status = delivery_status
                }

                const options = {
                    sort: { createdAt: -1 }, // Newest first
                };

                console.log('parcel query', req.query, query)

                const parcels = await parcelCollection.find(query, options).toArray();
                res.send(parcels);
            } catch (error) {
                console.error('Error fetching parcels:', error);
                res.status(500).send({ message: 'Failed to get parcels' });
            }
        });

        app.patch("/parcels/:id/assign", async (req, res) => {
            const parcelId = req.params.id;
            const { riderId, riderName, riderEmail } = req.body;

            try {
                // Update parcel
                await parcelCollection.updateOne(
                    { _id: new ObjectId(parcelId) },
                    {
                        $set: {
                            delivery_status: "rider_assigned",
                            assigned_rider_id: riderId,
                            assigned_rider_name: riderName,
                            assigned_rider_email: riderEmail,
                        },
                    }
                );

                // Update rider
                await riderCollection.updateOne(
                    { _id: new ObjectId(riderId) },
                    {
                        $set: {
                            work_status: "in_delivery",
                        },
                    }
                );

                res.send({ message: "Rider assigned" });
            } catch (err) {
                console.error(err);
                res.status(500).send({ message: "Failed to assign rider" });
            }
        });
        // update parcel status
        app.patch('/parcels/:id/status', async (req, res) => {
            const parcelId = req.params.id
            const { status } = req.body;
            console.log(parcelId, status, 'backend check');
            const updatedDoc = {
                delivery_status: status
            }
            if (
                status === 'in_transit') {
                updatedDoc.picked_At = new Date().toISOString()
            }
            if (status === 'delivered') {
                updatedDoc.delivered_at = new Date().toISOString()
            }

            try {
                const result = await parcelCollection.updateOne(
                    { _id: new ObjectId(parcelId) },
                    { $set: updatedDoc }
                )
                res.send(result)
            } catch (error) {
                console.log(error);
            }
        })

        // parcel detail by id 
        app.get('/parcels/payment/:id', async (req, res) => {
            const id = req.params.id
            const result = await parcelCollection.findOne({ _id: new ObjectId(id) })
            res.send(result)
        })
        // delete parcels
        app.delete('/parcels/:id', verifyToken, async (req, res) => {
            try {
                const id = req.params.id
                const query = { _id: new ObjectId(id) }
                const result = await parcelCollection.deleteOne(query)
                res.send(result)
            } catch (error) {
                console.log(error);
                res.status(500).send({ message: 'Failed to delete parcel' })
            }
        })

        // cash out 
        app.patch("/parcels/:id/cashout", async (req, res) => {
            const id = req.params.id;
            const result = await parcelCollection.updateOne(
                { _id: new ObjectId(id) },
                {
                    $set: {
                        cashout_status: "cashed_out",
                        cashed_out_at: new Date()
                    }
                }
            );
            res.send(result);
        });

        // db aggregate for admin dashboard
        app.get('/parcels/delivery/status-count', async (req, res) => {
            const pipeline = [
                {
                    $group: {
                        _id: '$delivery_status',
                        count : { $sum: 1 }
                    }
                },
                {
                    $project : {
                        status : '$_id',
                        count : 1,
                        _id : 0
                    }
                }
            ]
    const result = await parcelCollection.aggregate(pipeline).toArray()
    res.send(result)
})

// GET: Load completed parcel deliveries for a rider
app.get('/rider/completed-parcels', async (req, res) => {
    try {
        const email = req.query.email;

        if (!email) {
            return res.status(400).send({ message: 'Rider email is required' });
        }

        const query = {
            assigned_rider_email: email,
            delivery_status: {
                $in: ['delivered', 'service_center_delivered']
            },
        };

        const options = {
            sort: { creation_date: -1 }, // Latest first
        };

        const completedParcels = await parcelCollection.find(query, options).toArray();

        res.send(completedParcels);

    } catch (error) {
        console.error('Error loading completed parcels:', error);
        res.status(500).send({ message: 'Failed to load completed deliveries' });
    }
});


app.post('/parcels', async (req, res) => {
    const parcel = req.body;
    const result = await parcelCollection.insertOne(parcel);
    res.send(result);
});
// payment intent 
app.post('/create-payment-intent', async (req, res) => {
    try {
        const { amount } = req.body
        const paymentIntent = await stripe.paymentIntents.create({
            amount: amount,
            currency: 'usd',
            payment_method_types: ['card'],
        })
        res.send({ clientSecret: paymentIntent.client_secret })
    } catch (err) {
        res.status(500).send({ error: error.message })
    }
})
// payments
app.post('/payments', async (req, res) => {
    const payment = req.body;
    // update parcel documnet
    await parcelCollection.updateOne({ _id: new ObjectId(payment.parcelId) }, {
        $set: { payment_status: 'paid' }
    })
    // save data to payment 
    const result = await paymentCollection.insertOne(payment)
    res.send(result)
})
// payment hidtory
app.get('/payments/:email', verifyToken, async (req, res) => {
    const email = req.params.email
    console.log('decoded', req.decoded);
    if (req.decoded.email !== email) {
        return res.status(403).send({ message: "forbidden access" })
    }
    console.log(email);
    const result = await paymentCollection
        .find({ email: email })
        .sort({ paidAt: -1 })
        .toArray()
    res.send(result)
})

app.post("/trackings", async (req, res) => {
    const update = req.body;

    update.timestamp = new Date(); //  correct timestamp
    if (!update.tracking_id || !update.status) {
        return res.status(400).json({ message: "tracking_id and status are required." });
    }

    const result = await trackingsCollection.insertOne(update);
    res.status(201).json(result);
});

// /trackings
app.get("/trackings/:trackingId", async (req, res) => {
    const trackingId = req.params.trackingId;

    const updates = await trackingsCollection
        .find({ tracking_id: trackingId })
        .sort({ timestamp: 1 }) // sort by time ascending
        .toArray();

    res.json(updates);
});

// rider api
app.post('/riders', async (req, res) => {
    const riderData = req.body
    const result = await riderCollection.insertOne(riderData)
    res.send(result)
})
// pending riders
app.get('/riders/pending', async (req, res) => {
    const pendingRiders = await riderCollection.find({ status: "pending" }).toArray()
    res.send(pendingRiders)
})

app.get("/riders/available", async (req, res) => {
    const { district } = req.query;

    try {
        const riders = await riderCollection
            .find({
                district,
                // status: { $in: ["approved", "active"] },
                // work_status: "available",
            })
            .toArray();

        res.send(riders);
    } catch (err) {
        res.status(500).send({ message: "Failed to load riders" });
    }
});

// GET: Get pending delivery tasks for a rider
app.get('/rider/parcels', async (req, res) => {
    try {
        const email = req.query.email;
        console.log(email);

        if (!email) {
            return res.status(400).send({ message: 'Rider email is required' });
        }

        const query = {
            assigned_rider_email: email,
            delivery_status: { $in: ['rider_assigned', 'in_transit'] },
        };

        const options = {
            sort: { creation_date: -1 }, // Newest first
        };

        const parcels = await parcelCollection.find(query, options).toArray();
        res.send(parcels);
    } catch (error) {
        console.error('Error fetching rider tasks:', error);
        res.status(500).send({ message: 'Failed to get rider tasks' });
    }
});


app.get('/riders/approved', async (req, res) => {
    const pendingRiders = await riderCollection.find({ status: "approved" }).toArray()
    res.send(pendingRiders)
})
// approve and reject
app.patch('/riders/:id', async (req, res) => {
    const id = req.params.id
    const { status, email } = req.body
    console.log(status, 'in patch');
    const query = { _id: new ObjectId(id) }
    const updatedRIderStatus = {
        $set: {
            status
        }
    }
    // update user collection user role to rider
    if (status === 'approved') {
        const roleQuery = { email: email }
        console.log(email);
        const updatedRole = {
            $set: {
                role: 'rider'
            }
        }
        const roleResult = await usersCollection.updateOne(roleQuery, updatedRole)
        console.log(roleResult)
    }

    const result = await riderCollection.updateOne(query, updatedRIderStatus)
    res.send(result)
})


        // await client.db("admin").command({ ping: 1 });
        // console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
}
}
run().catch(console.dir);


app.get('/', (req, res) => {

    res.send(console.log('Parcel server is running'))
})
app.listen(port, () => {
    console.log(`port is running on ${port}`);
})