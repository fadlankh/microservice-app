require('dotenv').config()
const express = require('express')
const { Client } = require('pg')
const multer = require('multer')
const Minio = require('minio')
const validator = require('validator')
const cors = require('cors')

const app = express()

app.use(cors())
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// ============================
// MULTER CONFIG (MAX 5MB IMAGE)
// ============================

const upload = multer({
  limits: { fileSize: 5 * 1024 * 1024 },

  fileFilter: (req, file, cb) => {

    const allowed = ["image/png", "image/jpg", "image/jpeg"]

    if (!allowed.includes(file.mimetype)) {
      return cb(new Error("File harus berupa gambar"))
    }

    cb(null, true)
  }

}).single('photo')

// ============================
// POSTGRES CONNECTION
// ============================

const db = new Client({
  host: 'postgres',
  port: 5432, 
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB
})

async function connectDB() {

  while (true) {

    try {

      await db.connect()

      console.log("✅ PostgreSQL Connected")

      await db.query(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT NOT NULL,
          photo TEXT NOT NULL
        )
      `)

      break

    } catch (err) {

      console.log("⏳ Waiting for database...")
      await new Promise(res => setTimeout(res, 3000))

    }

  }

}

// ============================
// MINIO CONNECTION
// ============================

const minioClient = new Minio.Client({

  endPoint: 'minio',
  port: 9000,
  useSSL: false,
  accessKey: process.env.MINIO_ROOT_USER,
  secretKey: process.env.MINIO_ROOT_PASSWORD

})

async function connectMinIO() {

  while (true) {

    try {

      const exists = await minioClient.bucketExists(process.env.MINIO_BUCKET)

      if (!exists) {

        await minioClient.makeBucket(process.env.MINIO_BUCKET)

      }

      console.log("✅ MinIO Connected")

      break

    } catch (err) {

      console.log("⏳ Waiting for MinIO...")
      await new Promise(res => setTimeout(res, 3000))

    }

  }

}

// ============================
// CREATE USER
// ============================

app.post('/users', (req, res) => {

  upload(req, res, async function (err) {

    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: "File maksimal 5MB" })
    }

    if (err) {
      return res.status(400).json({ error: err.message })
    }

    try {

      const { name, email } = req.body
      const file = req.file

      if (!name || !email || !file) {

        return res.status(400).json({
          error: "Name, Email, dan Photo wajib diisi"
        })

      }

      if (!validator.isEmail(email)) {

        return res.status(400).json({
          error: "Format email tidak valid"
        })

      }

      const fileName = Date.now() + "_" + file.originalname

      await minioClient.putObject(
        process.env.MINIO_BUCKET,
        fileName,
        file.buffer
      )

      const photoUrl = `http://localhost:9000/${process.env.MINIO_BUCKET}/${fileName}`

      await db.query(
        'INSERT INTO users(name,email,photo) VALUES($1,$2,$3)',
        [name, email, photoUrl]
      )

      res.status(201).json({
        message: "User berhasil dibuat"
      })

    } catch (error) {

      console.error(error)

      res.status(500).json({
        error: "Server error"
      })

    }

  })

})

// ============================
// READ ALL USERS
// ============================

app.get('/users', async (req, res) => {

  try {

    const result = await db.query(
      'SELECT * FROM users ORDER BY id ASC'
    )

    res.json(result.rows)

  } catch (err) {

    res.status(500).json({
      error: "Server error"
    })

  }

})

// ============================
// READ USER BY ID
// ============================

app.get('/users/:id', async (req, res) => {

  try {

    const { id } = req.params

    const result = await db.query(
      'SELECT * FROM users WHERE id=$1',
      [id]
    )

    if (result.rows.length === 0) {

      return res.status(404).json({
        error: "User tidak ditemukan"
      })

    }

    res.json(result.rows[0])

  } catch (err) {

    res.status(500).json({
      error: "Server error"
    })

  }

})

// ============================
// UPDATE USER
// ============================

app.put('/users/:id', async (req, res) => {

  try {

    const { id } = req.params
    const { name, email } = req.body

    if (!name || !email) {

      return res.status(400).json({
        error: "Name dan Email wajib diisi"
      })

    }

    if (!validator.isEmail(email)) {

      return res.status(400).json({
        error: "Format email salah"
      })

    }

    const user = await db.query(
      'SELECT * FROM users WHERE id=$1',
      [id]
    )

    if (user.rows.length === 0) {

      return res.status(404).json({
        error: "User tidak ditemukan"
      })

    }

    await db.query(
      'UPDATE users SET name=$1,email=$2 WHERE id=$3',
      [name, email, id]
    )

    res.json({
      message: "User berhasil diupdate"
    })

  } catch (err) {

    res.status(500).json({
      error: "Server error"
    })

  }

})

// ============================
// DELETE USER
// ============================

app.delete('/users/:id', async (req, res) => {

  try {

    const { id } = req.params

    const user = await db.query(
      'SELECT * FROM users WHERE id=$1',
      [id]
    )

    if (user.rows.length === 0) {

      return res.status(404).json({
        error: "User tidak ditemukan"
      })

    }

    const photoUrl = user.rows[0].photo
    const fileName = photoUrl.split('/').pop()

    await minioClient.removeObject(
      process.env.MINIO_BUCKET,
      fileName
    )

    await db.query(
      'DELETE FROM users WHERE id=$1',
      [id]
    )

    res.json({
      message: "User berhasil dihapus"
    })

  } catch (err) {

    res.status(500).json({
      error: "Server error"
    })

  }

})

// ============================
// START SERVER
// ============================

async function startServer() {

  await connectDB()
  await connectMinIO()

  app.listen(8080, () => {

    console.log("🚀 API running on port 8080")

  })

}

startServer()