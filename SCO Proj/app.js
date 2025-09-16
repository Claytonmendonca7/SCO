// app.js — Backend with /api routes + Stripe + MSSQL
const express = require('express');
const sql = require('mssql');
const cors = require('cors');
const path = require('path');
const stripe = require('stripe')('sk_test_51S2SMcGqRQEokyaTISnPn6K6JbRBpVEaKHcdr60H1XMzBS6qn3zaBjGCK85NIauOPU0KvSq3lid7fiTHtGbrGkVf00S8iY80Kj'); // TODO: move to env in prod

const app = express();
const port = 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Database Configuration ---
const config = {
  user: 'myuser',
  password: 'StrongPassword123',
  server: 'localhost\\SQLEXPRESS',
  database: 'Your_Retail_DB',
  options: { encrypt: false, trustServerCertificate: true },
};

// --- Database Connection ---
let pool;
async function connectToDatabase() {
  try {
    if (!pool) {
      pool = await sql.connect(config);
      console.log('✅ Connected to SQL Server successfully!');
    }
  } catch (err) {
    console.error('❌ Database connection failed:', err);
  }
}
connectToDatabase();

// =========================
// API ENDPOINTS (/api prefix)
// =========================

// 0) Health check
app.get('/api/health', (_req, res) => res.json({ ok: true }));

// 1) Employee Login
app.post('/api/login', async (req, res) => {
  const { storeId, password } = req.body;
  if (!pool) return res.status(500).json({ error: 'Database not connected.' });

  try {
    const result = await pool
      .request()
      .input('storeId', sql.Int, storeId)
      .query('SELECT EmployeePIN FROM Stores WHERE StoreId = @storeId');

    if (result.recordset.length > 0) {
      const storedPin = result.recordset[0].EmployeePIN;
      if (password === storedPin) {
        res.status(200).json({ success: true, message: 'Login successful.' });
      } else {
        res.status(401).json({ success: false, message: 'Invalid credentials.' });
      }
    } else {
      res.status(401).json({ success: false, message: 'Store ID not found.' });
    }
  } catch (err) {
    console.error('Error during login:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// 1.5) Check phone
app.post('/api/check-phone', async (req, res) => {
  const { phoneNumber } = req.body;
  if (!pool) return res.status(500).json({ error: 'Database not connected.' });
  try {
    const result = await pool
      .request()
      .input('phoneNumber', sql.NVarChar, phoneNumber)
      .query('SELECT TOP 1 Name FROM Users WHERE PhoneNumber = @phoneNumber');

    if (result.recordset.length) {
      return res.json({ exists: true, name: result.recordset[0].Name });
    }
    return res.json({ exists: false });
  } catch (err) {
    console.error('Error during check-phone:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// 2) Dashboard Data
app.get('/api/dashboard/:storeId', async (req, res) => {
  const { storeId } = req.params;
  const { filterType, date } = req.query;

  if (!pool) return res.status(500).json({ error: 'Database not connected.' });

  try {
    let sales = 0, abv = 0, abq = 0, rating = 0;
    
    let salesResult, itemsResult, ratingsResult;
    
    switch (filterType) {
      case 'daily':
        const selectedDateDaily = new Date(date);
        salesResult = await pool.request().input('storeId', sql.Int, storeId).input('selectedDate', sql.Date, selectedDateDaily).query(`
          SELECT SUM(TotalAmount) AS Sales, AVG(TotalAmount) AS ABV FROM Receipts WHERE StoreId = @storeId AND CAST(PurchaseDate AS DATE) = @selectedDate;
        `);
        itemsResult = await pool.request().input('storeId', sql.Int, storeId).input('selectedDate', sql.Date, selectedDateDaily).query(`
          SELECT SUM(T2.Quantity) AS TotalItems, COUNT(T1.ReceiptId) AS TotalReceipts FROM Receipts T1 JOIN ReceiptItems T2 ON T1.ReceiptId = T2.ReceiptId WHERE T1.StoreId = @storeId AND CAST(T1.PurchaseDate AS DATE) = @selectedDate;
        `);
        sales = salesResult.recordset[0].Sales;
        abv = salesResult.recordset[0].ABV;
        abq = itemsResult.recordset[0].TotalReceipts ? itemsResult.recordset[0].TotalItems / itemsResult.recordset[0].TotalReceipts : 0;
        ratingsResult = await pool.request().input('storeId', sql.Int, storeId).input('selectedDate', sql.Date, selectedDateDaily).query(`
          SELECT AVG(CAST(RatingValue AS FLOAT)) AS DailyRating FROM StoreRatings WHERE StoreId = @storeId AND CAST(RatingDate AS DATE) = @selectedDate;
        `);
        rating = ratingsResult.recordset[0].DailyRating;
        break;

      case 'monthly':
        const selectedDateMonthly = new Date(date);
        salesResult = await pool.request().input('storeId', sql.Int, storeId).input('selectedDate', sql.Date, selectedDateMonthly).query(`
          SELECT SUM(TotalAmount) AS Sales, AVG(TotalAmount) AS ABV FROM Receipts WHERE StoreId = @storeId AND DATEPART(month, PurchaseDate) = DATEPART(month, @selectedDate) AND YEAR(PurchaseDate) = YEAR(@selectedDate);
        `);
        itemsResult = await pool.request().input('storeId', sql.Int, storeId).input('selectedDate', sql.Date, selectedDateMonthly).query(`
          SELECT SUM(T2.Quantity) AS TotalItems, COUNT(T1.ReceiptId) AS TotalReceipts FROM Receipts T1 JOIN ReceiptItems T2 ON T1.ReceiptId = T2.ReceiptId WHERE T1.StoreId = @storeId AND DATEPART(month, T1.PurchaseDate) = DATEPART(month, @selectedDate) AND YEAR(T1.PurchaseDate) = YEAR(@selectedDate);
        `);
        sales = salesResult.recordset[0].Sales;
        abv = salesResult.recordset[0].ABV;
        abq = itemsResult.recordset[0].TotalReceipts ? itemsResult.recordset[0].TotalItems / itemsResult.recordset[0].TotalReceipts : 0;
        ratingsResult = await pool.request().input('storeId', sql.Int, storeId).input('selectedDate', sql.Date, selectedDateMonthly).query(`
          SELECT AVG(CAST(RatingValue AS FLOAT)) AS MonthlyRating FROM StoreRatings WHERE StoreId = @storeId AND DATEPART(month, RatingDate) = DATEPART(month, @selectedDate) AND YEAR(RatingDate) = YEAR(@selectedDate);
        `);
        rating = ratingsResult.recordset[0].MonthlyRating;
        break;

      case 'yearly':
        const selectedDateYearly = new Date(date);
        salesResult = await pool.request().input('storeId', sql.Int, storeId).input('selectedDate', sql.Date, selectedDateYearly).query(`
          SELECT SUM(TotalAmount) AS Sales, AVG(TotalAmount) AS ABV FROM Receipts WHERE StoreId = @storeId AND YEAR(PurchaseDate) = YEAR(@selectedDate);
        `);
        itemsResult = await pool.request().input('storeId', sql.Int, storeId).input('selectedDate', sql.Date, selectedDateYearly).query(`
          SELECT SUM(T2.Quantity) AS TotalItems, COUNT(T1.ReceiptId) AS TotalReceipts FROM Receipts T1 JOIN ReceiptItems T2 ON T1.ReceiptId = T2.ReceiptId WHERE T1.StoreId = @storeId AND YEAR(T1.PurchaseDate) = YEAR(@selectedDate);
        `);
        sales = salesResult.recordset[0].Sales;
        abv = salesResult.recordset[0].ABV;
        abq = itemsResult.recordset[0].TotalReceipts ? itemsResult.recordset[0].TotalItems / itemsResult.recordset[0].TotalReceipts : 0;
        ratingsResult = await pool.request().input('storeId', sql.Int, storeId).input('selectedDate', sql.Date, selectedDateYearly).query(`
          SELECT AVG(CAST(RatingValue AS FLOAT)) AS YearlyRating FROM StoreRatings WHERE StoreId = @storeId AND YEAR(RatingDate) = YEAR(@selectedDate);
        `);
        rating = ratingsResult.recordset[0].YearlyRating;
        break;
    }

    const ytdRatingsResult = await pool.request().input('storeId', sql.Int, storeId).query(`
      SELECT AVG(CAST(RatingValue AS FLOAT)) AS YTD_Rating FROM StoreRatings WHERE StoreId = @storeId AND YEAR(RatingDate) = YEAR(GETDATE());
    `);
    const ytdRating = ytdRatingsResult.recordset[0].YTD_Rating;

    res.status(200).json({
      sales: Number(sales || 0).toFixed(2),
      abv: Number(abv || 0).toFixed(2),
      abq: Number(abq || 0).toFixed(2),
      rating: Number(rating || 0).toFixed(2),
      ytdRating: Number(ytdRating || 0).toFixed(2),
      lastUpdated: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Error fetching dashboard data:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// NEW: API endpoint to fetch historical sales data for charting
app.get('/api/dashboard-history/:storeId', async (req, res) => {
  const { storeId } = req.params;
  const today = new Date().toISOString().split('T')[0];

  if (!pool) return res.status(500).json({ error: 'Database not connected.' });

  try {
    const historyResult = await pool.request()
      .input('storeId', sql.Int, storeId)
      .query(`
        SELECT
          CAST(PurchaseDate AS DATE) AS SalesDate,
          SUM(TotalAmount) AS TotalSales,
          AVG(TotalAmount) AS ABV,
          COUNT(DISTINCT T1.ReceiptId) AS TotalReceipts,
          SUM(T2.Quantity) AS TotalItems,
          AVG(T3.RatingValue) AS AvgRating
        FROM Receipts T1
        LEFT JOIN ReceiptItems T2 ON T1.ReceiptId = T2.ReceiptId
        LEFT JOIN StoreRatings T3 ON T1.StoreId = T3.StoreId AND CAST(T1.PurchaseDate AS DATE) = CAST(T3.RatingDate AS DATE)
        WHERE
          T1.StoreId = @storeId
          AND T1.PurchaseDate >= DATEADD(day, -7, GETDATE())
        GROUP BY
          CAST(PurchaseDate AS DATE)
        ORDER BY
          SalesDate;
      `);

    const historicalData = historyResult.recordset.map(record => ({
      date: record.SalesDate.toISOString().split('T')[0],
      sales: Number(record.TotalSales).toFixed(2),
      abv: Number(record.ABV).toFixed(2),
      abq: Number(record.TotalItems / record.TotalReceipts || 0).toFixed(2),
      rating: Number(record.AvgRating || 0).toFixed(2),
    }));

    res.status(200).json({
      history: historicalData,
    });
  } catch (err) {
    console.error('Error fetching historical data:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// 3) Create a Stripe Payment Intent
app.post('/api/create-payment-intent', async (req, res) => {
  const { amount, currency } = req.body; // amount in smallest unit
  try {
    if (!amount || !currency) {
      return res.status(400).json({ error: 'amount and currency are required' });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency,
      automatic_payment_methods: { enabled: true },
    });

    res.status(200).json({ clientSecret: paymentIntent.client_secret });
  } catch (err) {
    console.error('Error creating payment intent:', err);
    res.status(500).json({ error: 'Failed to create payment intent.' });
  }
});

// 4) Save a Complete Checkout Transaction
app.post('/api/save-checkout', async (req, res) => {
  const { phoneNumber, name, receiptItems, total, storeId } = req.body;
  if (!pool) return res.status(500).json({ error: 'Database not connected.' });

  if (!Array.isArray(receiptItems)) {
    return res.status(400).json({ error: 'receiptItems must be an array' });
  }

  const transaction = new sql.Transaction(pool);
  try {
    await transaction.begin();

    let userId;
    const userCheck = await transaction
      .request()
      .input('phoneNumber', sql.NVarChar, phoneNumber)
      .query('SELECT UserId FROM Users WHERE PhoneNumber = @phoneNumber');

    if (userCheck.recordset.length > 0) {
      userId = userCheck.recordset[0].UserId;
    } else {
      const userInsert = await transaction
        .request()
        .input('name', sql.NVarChar, name || 'Guest')
        .input('phoneNumber', sql.NVarChar, phoneNumber || null)
        .query(`
          INSERT INTO Users (Name, PhoneNumber)
          VALUES (@name, @phoneNumber);
          SELECT SCOPE_IDENTITY() as UserId;
        `);
      userId = Number(userInsert.recordset[0].UserId);
    }

    const receiptInsert = await transaction
      .request()
      .input('userId', sql.Int, userId)
      .input('storeId', sql.Int, storeId)
      .input('totalAmount', sql.Decimal(18, 2), total)
      .query(`
        INSERT INTO Receipts (UserId, StoreId, TotalAmount, PurchaseDate)
        VALUES (@userId, @storeId, @totalAmount, GETDATE());
        SELECT SCOPE_IDENTITY() as ReceiptId;
      `);

    const receiptId = Number(receiptInsert.recordset[0].ReceiptId);

    for (const item of receiptItems) {
      await transaction
        .request()
        .input('receiptId', sql.Int, receiptId)
        .input('itemName', sql.NVarChar, item.name)
        .input('quantity', sql.Int, item.quantity)
        .input('pricePerItem', sql.Decimal(18, 2), item.price)
        .query(`
          INSERT INTO ReceiptItems (ReceiptId, ItemName, Quantity, PricePerItem)
          VALUES (@receiptId, @itemName, @quantity, @pricePerItem);
        `);
    }

    await transaction.commit();
    res.status(200).json({ message: 'Transaction and receipt saved successfully!' });
  } catch (err) {
    try { await transaction.rollback(); } catch (_) {}
    console.error('Transaction failed:', err);
    res.status(500).json({ error: 'Failed to save data. Transaction rolled back.' });
  }
});

// 5) Save a Store Rating
app.post('/api/submit-rating', async (req, res) => {
  const { storeId, ratingValue } = req.body;
  if (!pool) return res.status(500).json({ error: 'Database not connected.' });

  // --- ADDED VALIDATION ---
  if (ratingValue === undefined || ratingValue === null) {
    return res.status(400).json({ success: false, message: 'Rating value is required.' });
  }

  try {
    await pool
      .request()
      .input('storeId', sql.Int, storeId)
      .input('ratingValue', sql.Int, ratingValue) // Ensure value is a number
      .query(`
        INSERT INTO StoreRatings (StoreId, RatingValue, RatingDate)
        VALUES (@storeId, @ratingValue, GETDATE());
      `);

    res.status(200).json({ success: true, message: 'Rating saved.' });
  } catch (err) {
    console.error('Error saving rating:', err);
    res.status(500).json({ error: 'Failed to save rating.' });
  }
});

// =========================
// Start Server
// =========================
app.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port}`);
});