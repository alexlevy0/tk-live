import express from "express"
import { WebcastPushConnection } from "tiktok-live-connector"
import { WebSocketServer } from "ws"
import { createServer } from "http"
import { fileURLToPath } from "url"
import { dirname, join } from "path"
import { readFile } from "fs/promises"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const app = express()
const port = process.env.PORT || 3001

const server = createServer(app)
const wss = new WebSocketServer({ server })

const wsConnections = new Set()
let currentTiktokConnection = null

server.keepAliveTimeout = 120 * 1000
server.headersTimeout = 120 * 1000

wss.on("connection", (ws) => {
	console.log("Nouveau client WebSocket connecté")
	wsConnections.add(ws)

	ws.on("message", async (message) => {
		try {
			const data = JSON.parse(message)

			if (data.type === "connect") {
				await disconnectTiktokConnection()
				console.log("TikTok :", data.username)
				initTiktokLiveListener(data.username, ws)
			}
		} catch (error) {
			console.error("Erreur lors du traitement du message:", error)
		}
	})

	ws.on("close", async () => {
		console.log("Client WebSocket déconnecté")
		wsConnections.delete(ws)
		await disconnectTiktokConnection()
	})
})

const disconnectTiktokConnection = async () => {
	if (currentTiktokConnection) {
		try {
			await currentTiktokConnection.disconnect()
			currentTiktokConnection = null
		} catch (error) {
			console.error("Erreur lors de la déconnexion:", error)
		}
	}
}

const tiktokConfig = {
	processInitialData: false,
	enableExtendedGiftInfo: true,
	enableWebsocketUpgrade: true,
	requestPollingIntervalMs: 2000,
	sessionId: process.env.TIKTOK_SESSION_ID || "123456789",
}

const broadcastToAll = (message) => {
	wsConnections.forEach((client) => {
		if (client.readyState === 1) {
			client.send(JSON.stringify(message))
		}
	})
}

const initTiktokLiveListener = async (tiktokLiveAccount, ws) => {
	try {
		const tiktokLiveConnection = new WebcastPushConnection(tiktokLiveAccount, tiktokConfig)
		const state = await tiktokLiveConnection.connect()
		currentTiktokConnection = tiktokLiveConnection

		console.info(`Connecté à roomId ${state.roomId}`)
		console.info(`Connecté au compte TikTok Live ${tiktokLiveAccount}`)

		ws.send(
			JSON.stringify({
				type: "connection_status",
				status: "connected",
				username: tiktokLiveAccount,
			}),
		)

		let tiktokLiveLastMessage = null

		// Messages du chat
		tiktokLiveConnection.on("chat", (data) => {
			if (tiktokLiveLastMessage === data.comment) {
				return
			}

			tiktokLiveLastMessage = data.comment
			console.log(`Chat: ${data.comment}`)

			broadcastToAll({
				type: "chat",
				message: data.comment,
				userId: data.userId,
				username: data.uniqueId,
				timestamp: new Date().toISOString(),
			})
		})

		// Cadeaux
		tiktokLiveConnection.on("gift", (data) => {
			let giftMessage = ""
			if (data.giftType === 1 && !data.repeatEnd) {
				giftMessage = `💝 ${data.uniqueId} envoie ${data.giftName} x${data.repeatCount}`
			} else {
				giftMessage = `💝 ${data.uniqueId} a envoyé ${data.giftName} x${data.repeatCount}`
			}

			broadcastToAll({
				type: "chat",
				message: giftMessage,
				userId: data.userId,
				username: "SYSTEM",
				timestamp: new Date().toISOString(),
				isSystem: true,
			})
		})

		// Likes
		tiktokLiveConnection.on("like", (data) => {
			broadcastToAll({
				type: "chat",
				message: `❤️ ${data.uniqueId} envoie ${data.likeCount} likes`,
				userId: data.userId,
				username: "SYSTEM",
				timestamp: new Date().toISOString(),
				isSystem: true,
			})
		})

		// Follows
		tiktokLiveConnection.on("follow", (data) => {
			broadcastToAll({
				type: "chat",
				message: `✨ ${data.uniqueId} suit maintenant le compte`,
				userId: data.userId,
				username: "SYSTEM",
				timestamp: new Date().toISOString(),
				isSystem: true,
			})
		})

		// Shares
		tiktokLiveConnection.on("share", (data) => {
			broadcastToAll({
				type: "chat",
				message: `🔄 ${data.uniqueId} a partagé le live`,
				userId: data.userId,
				username: "SYSTEM",
				timestamp: new Date().toISOString(),
				isSystem: true,
			})
		})

		// Nouveaux viewers
		tiktokLiveConnection.on("member", (data) => {
			broadcastToAll({
				type: "chat",
				message: `👋 ${data.uniqueId} rejoint le live`,
				userId: data.userId,
				username: "SYSTEM",
				timestamp: new Date().toISOString(),
				isSystem: true,
			})
		})

		// Erreurs
		tiktokLiveConnection.on("error", (err) => {
			console.error("Erreur TikTok:", err)
			ws.send(
				JSON.stringify({
					type: "connection_status",
					status: "error",
					message: err.message,
				}),
			)
		})
	} catch (error) {
		console.error("Erreur de connexion TikTok Live:", error)
		ws.send(
			JSON.stringify({
				type: "connection_status",
				status: "error",
				message: error.message,
			}),
		)
	}
}

app.get("/", async (req, res) => {
	try {
		const htmlPath = join(__dirname, "index.html")
		const content = await readFile(htmlPath, "utf8")
		res.type("html").send(content)
	} catch (error) {
		console.error("Erreur lors de la lecture du fichier HTML:", error)
		res.status(500).send("Erreur serveur")
	}
})

server.listen(port, () => {
	console.log(`Serveur démarré sur le port ${port}`)
})
