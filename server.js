const path = require("path");
const crypto = require("crypto");
const express = require("express");
const http = require("http");
const session = require("express-session");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
	cors: {
		origin: "*",
		methods: ["GET", "POST"],
	},
});

app.set("trust proxy", 1);

const sessionMiddleware = session({
	secret: process.env.SESSION_SECRET || "dev-secret-change-in-production",
	resave: false,
	saveUninitialized: false,
	proxy: true,
	cookie: {
		httpOnly: true,
		sameSite: "lax",
		secure: process.env.NODE_ENV === "production",
		maxAge: 7 * 24 * 60 * 60 * 1000,
	},
});

app.use(sessionMiddleware);
app.use(express.urlencoded({ extended: false }));

io.use((socket, next) => {
	sessionMiddleware(socket.request, socket.request.res || {}, next);
});

const PORT = process.env.PORT || 3000;
const SLOT_MINUTES = 15;
const CLIENT_COOKIE_NAME = "client_id";
const MASTER_REMEMBER_COOKIE_NAME = "master_auth";
const MASTER_REMEMBER_MAX_AGE = 180 * 24 * 60 * 60 * 1000;
const MASTER_PAST_DAYS = 31;
const MASTER_FUTURE_DAYS = 62;
const CUSTOMER_FUTURE_DAYS = 28;

const state = {
	settings: {
		startHour: 9,
		endHour: 18,
		slotMinutes: SLOT_MINUTES,
	},
	weekWorkDays: {},
	slots: {},
};

function pad(num) {
	return String(num).padStart(2, "0");
}

function dateKey(date) {
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseDateKey(value) {
	const [y, m, d] = String(value || "").split("-").map(Number);
	if (!y || !m || !d) return null;
	return new Date(y, m - 1, d);
}

function startOfDay(date) {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, days) {
	const d = new Date(date);
	d.setDate(d.getDate() + days);
	return d;
}

function startOfWeek(date) {
	const d = startOfDay(date);
	const day = (d.getDay() + 6) % 7;
	d.setDate(d.getDate() - day);
	return d;
}

function weekdayToWeekOffset(dayNum) {
	return (Number(dayNum) + 6) % 7;
}

function dateForWeekDay(weekStartDate, dayNum) {
	return addDays(weekStartDate, weekdayToWeekOffset(dayNum));
}

function weekKeyFromDate(date) {
	return dateKey(startOfWeek(date));
}

function timePartFromMinutes(totalMinutes) {
	const hour = Math.floor(totalMinutes / 60);
	const minute = totalMinutes % 60;
	return `${pad(hour)}:${pad(minute)}`;
}

function slotDateTime(slot) {
	const day = parseDateKey(slot.datePart);
	if (!day) return null;
	const [h, m] = String(slot.timePart || "00:00").split(":").map(Number);
	return new Date(day.getFullYear(), day.getMonth(), day.getDate(), Number(h) || 0, Number(m) || 0, 0, 0);
}

function isPastSlot(slot, refDate = new Date()) {
	const dt = slotDateTime(slot);
	if (!dt) return false;
	return dt.getTime() < refDate.getTime();
}

function baseKey(datePart, timePart) {
	return `${datePart}T${timePart}`;
}

function generateId() {
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function parseCookies(cookieHeader) {
	const raw = String(cookieHeader || "");
	if (!raw) return {};
	return raw.split(";").reduce((acc, chunk) => {
		const [k, ...rest] = chunk.trim().split("=");
		if (!k) return acc;
		acc[k] = decodeURIComponent(rest.join("=") || "");
		return acc;
	}, {});
}

function getCustomerIdFromCookieHeader(cookieHeader) {
	const cookies = parseCookies(cookieHeader);
	const value = cookies[CLIENT_COOKIE_NAME];
	if (!value || typeof value !== "string") return "";
	return value.trim();
}

function getMasterCredentials() {
	return {
		email: process.env.MASTER_EMAIL || "master@example.com",
		password: process.env.MASTER_PASSWORD || "changeme",
	};
}

function createMasterRememberToken() {
	const { email, password } = getMasterCredentials();
	const secret = process.env.SESSION_SECRET || "dev-secret-change-in-production";
	const payload = `${email.trim().toLowerCase()}|${password}`;
	return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

function hasValidMasterRememberCookie(req) {
	const cookies = parseCookies(req?.headers?.cookie);
	const token = String(cookies[MASTER_REMEMBER_COOKIE_NAME] || "").trim();
	if (!token) return false;
	const expected = createMasterRememberToken();
	return token === expected;
}

function persistMasterRememberCookie(res) {
	res.cookie(MASTER_REMEMBER_COOKIE_NAME, createMasterRememberToken(), {
		httpOnly: true,
		sameSite: "lax",
		secure: process.env.NODE_ENV === "production",
		maxAge: MASTER_REMEMBER_MAX_AGE,
		path: "/",
	});
}

function getOrCreateCustomerId(requestObj) {
	if (!requestObj) return generateId();

	const cookieCustomerId = getCustomerIdFromCookieHeader(requestObj.headers && requestObj.headers.cookie);
	if (cookieCustomerId) {
		if (requestObj.session) {
			requestObj.session.customerId = cookieCustomerId;
		}
		return cookieCustomerId;
	}

	if (requestObj.session && requestObj.session.customerId) {
		return requestObj.session.customerId;
	}

	const generated = generateId();
	if (requestObj.session) {
		requestObj.session.customerId = generated;
	}
	return generated;
}

function ensureCustomerIdentity(req, res, next) {
	if (req.session && req.session.isMaster) return next();

	const cookieCustomerId = getCustomerIdFromCookieHeader(req.headers && req.headers.cookie);
	const customerId = cookieCustomerId || req.session?.customerId || generateId();

	if (req.session) req.session.customerId = customerId;

	if (!cookieCustomerId) {
		res.cookie(CLIENT_COOKIE_NAME, customerId, {
			httpOnly: true,
			sameSite: "lax",
			secure: process.env.NODE_ENV === "production",
			maxAge: 365 * 24 * 60 * 60 * 1000,
			path: "/",
		});
	}

	next();
}

app.use(ensureCustomerIdentity);

app.use((req, res, next) => {
	if (req.session?.isMaster) return next();
	if (!hasValidMasterRememberCookie(req)) return next();
	req.session.isMaster = true;
	next();
});

function normalizeStatus(status) {
	return status === "busy" ? "rejected" : status;
}

function createSlot({ id, datePart, timePart, kind = "primary", linkedPrimaryId = "" }) {
	return {
		id,
		baseKey: baseKey(datePart, timePart),
		datePart,
		timePart,
		kind,
		linkedPrimaryId,
		status: "free",
		customerId: "",
		customerName: "",
		customerPhone: "",
		customerComment: "",
		comment: "",
		history: [],
		touched: false,
		hiddenByMaster: false,
		updatedAt: new Date().toISOString(),
	};
}

function getPrimarySlotByBase(base) {
	return Object.values(state.slots).find((s) => s.baseKey === base && s.kind === "primary") || null;
}

function getExtraSlotForPrimary(primaryId) {
	return Object.values(state.slots).find((s) => s.kind === "extra" && s.linkedPrimaryId === primaryId) || null;
}

function ensurePrimarySlot(datePart, timePart) {
	const base = baseKey(datePart, timePart);
	const exists = getPrimarySlotByBase(base);
	if (exists) return exists;
	const id = `${base}#p`;
	state.slots[id] = createSlot({ id, datePart, timePart, kind: "primary" });
	return state.slots[id];
}

function ensureWeekSlots(weekKey) {
	const weekStart = parseDateKey(weekKey);
	if (!weekStart) return;
	const workDays = Array.isArray(state.weekWorkDays[weekKey]) ? state.weekWorkDays[weekKey] : [];

	for (let i = 0; i < 7; i += 1) {
		const d = addDays(weekStart, i);
		if (!workDays.includes(d.getDay())) continue;
		const dayId = dateKey(d);
		let totalMinutes = state.settings.startHour * 60;
		const endMinutes = state.settings.endHour * 60;
		while (totalMinutes + SLOT_MINUTES <= endMinutes) {
			ensurePrimarySlot(dayId, timePartFromMinutes(totalMinutes));
			totalMinutes += SLOT_MINUTES;
		}
	}
}

function syncSlotsForWorkingHours() {
	const today = startOfDay(new Date());
	const startMinutes = Number(state.settings.startHour) * 60;
	const endMinutes = Number(state.settings.endHour) * 60;

	Object.keys(state.slots).forEach((slotId) => {
		const slot = state.slots[slotId];
		if (!slot) return;
		const d = parseDateKey(slot.datePart);
		if (!d || startOfDay(d) < today) return;
		const [h, m] = String(slot.timePart || "00:00").split(":").map(Number);
		const totalMinutes = (Number(h) || 0) * 60 + (Number(m) || 0);
		const inHours = totalMinutes >= startMinutes && (totalMinutes + SLOT_MINUTES) <= endMinutes;
		if (!inHours && !slot.touched) {
			delete state.slots[slotId];
		}
	});

	Object.keys(state.weekWorkDays).forEach((weekKey) => {
		ensureWeekSlots(weekKey);
	});
}

function initDefaultWeeks() {
	const today = startOfDay(new Date());
	const start = addDays(today, -MASTER_PAST_DAYS);
	const end = addDays(today, MASTER_FUTURE_DAYS);
	for (let d = startOfWeek(start); d <= end; d = addDays(d, 7)) {
		const wk = dateKey(d);
		if (!state.weekWorkDays[wk]) {
			state.weekWorkDays[wk] = [2, 5];
		}
		ensureWeekSlots(wk);
	}
}

initDefaultWeeks();

function mapCustomerStatus(slot, belongsToCustomer) {
	if (belongsToCustomer) {
		return slot.status;
	}
	if (slot.status === "free") return "free";
	return "busy";
}

function inRange(datePart, rangeStart, rangeEnd) {
	const d = parseDateKey(datePart);
	if (!d) return false;
	return d >= rangeStart && d <= rangeEnd;
}

function sanitizeSlotForCustomer(slot, customerId) {
	const belongs = slot.customerId && slot.customerId === customerId;
	return {
		id: slot.id,
		baseKey: slot.baseKey,
		datePart: slot.datePart,
		timePart: slot.timePart,
		kind: slot.kind,
		status: mapCustomerStatus(slot, belongs),
		updatedAt: slot.updatedAt,
		customerComment: belongs ? slot.customerComment || "" : "",
		comment: belongs ? slot.comment || "" : "",
		history: belongs ? (slot.history || []) : [],
	};
}

function buildStateForSocket(socket) {
	const sessionObj = socket.request.session;
	const isMaster = !!(sessionObj && sessionObj.isMaster);
	const today = startOfDay(new Date());
	const now = new Date();
	const masterRangeStart = addDays(today, -MASTER_PAST_DAYS);
	const masterRangeEnd = addDays(today, MASTER_FUTURE_DAYS);
	const customerRangeStart = today;
	const customerRangeEnd = addDays(today, CUSTOMER_FUTURE_DAYS);

	if (isMaster) {
		const masterSlots = {};
		Object.values(state.slots).forEach((slot) => {
			if (slot.hiddenByMaster) return;
			if (!inRange(slot.datePart, masterRangeStart, masterRangeEnd)) return;
			masterSlots[slot.id] = slot;
		});
		return {
			settings: state.settings,
			weekWorkDays: state.weekWorkDays,
			slots: masterSlots,
			meta: {
				mode: "master",
				rangeStart: dateKey(masterRangeStart),
				rangeEnd: dateKey(masterRangeEnd),
				today: dateKey(today),
				nowIso: now.toISOString(),
				slotMinutes: SLOT_MINUTES,
			},
		};
	}

	const currentCustomerId = getOrCreateCustomerId(socket.request);
	const grouped = {};
	Object.values(state.slots).forEach((slot) => {
		if (slot.hiddenByMaster) return;
		if (!inRange(slot.datePart, customerRangeStart, customerRangeEnd)) return;
		if (isPastSlot(slot, now)) return;
		if (!grouped[slot.baseKey]) grouped[slot.baseKey] = [];
		grouped[slot.baseKey].push(slot);
	});

	const customerSlots = {};
	Object.values(grouped).forEach((group) => {
		const owned = group.filter((s) => s.customerId && s.customerId === currentCustomerId);
		if (owned.length > 0) {
			owned.forEach((slot) => {
				customerSlots[slot.id] = sanitizeSlotForCustomer(slot, currentCustomerId);
			});
			return;
		}

		const extras = group.filter((s) => s.kind === "extra");
		if (extras.length > 0) {
			const candidate = extras.find((s) => s.status === "free") || extras[0];
			customerSlots[candidate.id] = sanitizeSlotForCustomer(candidate, currentCustomerId);
			return;
		}

		const primary = group.find((s) => s.kind === "primary") || group[0];
		if (primary) {
			customerSlots[primary.id] = sanitizeSlotForCustomer(primary, currentCustomerId);
		}
	});

	return {
		settings: state.settings,
		weekWorkDays: state.weekWorkDays,
		slots: customerSlots,
		meta: {
			mode: "customer",
			rangeStart: dateKey(customerRangeStart),
			rangeEnd: dateKey(customerRangeEnd),
			today: dateKey(today),
			nowIso: now.toISOString(),
			slotMinutes: SLOT_MINUTES,
		},
	};
}

function emitState() {
	io.sockets.sockets.forEach((sock) => {
		sock.emit("state", buildStateForSocket(sock));
	});
}

function resetSlot(slot) {
	slot.status = "free";
	slot.customerId = "";
	slot.customerName = "";
	slot.customerPhone = "";
	slot.customerComment = "";
	slot.comment = "";
	slot.updatedAt = new Date().toISOString();
}

function ensureExtraSlot(primarySlot) {
	let extra = getExtraSlotForPrimary(primarySlot.id);
	if (!extra) {
		const id = `${primarySlot.baseKey}#e1`;
		extra = createSlot({
			id,
			datePart: primarySlot.datePart,
			timePart: primarySlot.timePart,
			kind: "extra",
			linkedPrimaryId: primarySlot.id,
		});
		state.slots[id] = extra;
	}
	return extra;
}

function tryRemoveUnusedExtra(primarySlot) {
	const extra = getExtraSlotForPrimary(primarySlot.id);
	if (!extra) return;
	if (extra.status === "free" && !extra.customerId) {
		delete state.slots[extra.id];
	}
}

io.on("connection", (socket) => {
	socket.emit("state", buildStateForSocket(socket));

	function isMaster() {
		return !!(socket.request.session && socket.request.session.isMaster);
	}

	socket.on("customer:confirmSlot", ({ slotId, selectedStatus, customerName, customerPhone }) => {
		const slot = state.slots[slotId];
		if (!slot) return;
		if (isPastSlot(slot)) {
			socket.emit("error:message", "Нельзя менять прошедший слот.");
			return;
		}

		const customerId = getOrCreateCustomerId(socket.request);
		const normalizedSelected = normalizeStatus(selectedStatus);
		if (normalizedSelected !== "requested" && normalizedSelected !== "free") return;

		const ownedByCurrentCustomer = slot.customerId && slot.customerId === customerId;
		if (!ownedByCurrentCustomer && slot.status !== "free") {
			socket.emit("error:message", "Этот слот уже занят другим клиентом.");
			return;
		}

		if (normalizedSelected === "requested") {
			slot.status = "requested";
			slot.customerId = customerId;
			slot.customerName = String(customerName || "").trim().slice(0, 60);
			slot.customerPhone = String(customerPhone || "").trim().slice(0, 40);
		} else {
			if (!ownedByCurrentCustomer) {
				socket.emit("error:message", "Нельзя отменить чужую запись.");
				return;
			}
			resetSlot(slot);
		}

		slot.touched = true;
		slot.history = [
			...(slot.history || []),
			{
				at: new Date().toISOString(),
				by: "customer",
				customerId,
				toStatus: slot.status,
			},
		];
		slot.updatedAt = new Date().toISOString();
		emitState();
	});

	socket.on("executor:confirmSlot", ({ slotId, selectedStatus }) => {
		if (!isMaster()) return;
		const slot = state.slots[slotId];
		if (!slot) return;
		if (isPastSlot(slot)) {
			socket.emit("error:message", "Прошедшие слоты нельзя менять по статусу.");
			return;
		}

		const allowedStatuses = ["free", "requested", "confirmed", "rejected", "split"];
		const normalizedSelected = normalizeStatus(selectedStatus);
		if (!allowedStatuses.includes(normalizedSelected)) return;

		if (normalizedSelected === "split") {
			if (slot.kind !== "primary") {
				socket.emit("error:message", "Статус 'частично' доступен только для основного слота.");
				return;
			}
			slot.status = "split";
			ensureExtraSlot(slot);
		} else if (normalizedSelected === "free") {
			resetSlot(slot);
			if (slot.kind === "primary") {
				tryRemoveUnusedExtra(slot);
			}
		} else {
			slot.status = normalizedSelected;
			if (slot.kind === "primary" && normalizedSelected !== "split") {
				tryRemoveUnusedExtra(slot);
			}
		}

		slot.touched = true;
		slot.history = [
			...(slot.history || []),
			{
				at: new Date().toISOString(),
				by: "executor",
				customerId: slot.customerId || "",
				toStatus: slot.status,
			},
		];
		slot.updatedAt = new Date().toISOString();
		emitState();
	});

	socket.on("executor:setComment", ({ slotId, comment }) => {
		if (!isMaster()) return;
		const slot = state.slots[slotId];
		if (!slot) return;
		slot.comment = String(comment || "").trim().slice(0, 300);
		slot.touched = true;
		slot.history = [
			...(slot.history || []),
			{
				at: new Date().toISOString(),
				by: "executor",
				customerId: slot.customerId || "",
				kind: "comment",
				comment: slot.comment,
			},
		];
		slot.updatedAt = new Date().toISOString();
		emitState();
	});

	socket.on("customer:setComment", ({ slotId, comment }) => {
		const slot = state.slots[slotId];
		if (!slot) return;
		const customerId = getOrCreateCustomerId(socket.request);
		if (!slot.customerId || slot.customerId !== customerId) {
			socket.emit("error:message", "Нельзя менять комментарий в чужом слоте.");
			return;
		}
		slot.customerComment = String(comment || "").trim().slice(0, 300);
		slot.touched = true;
		slot.history = [
			...(slot.history || []),
			{
				at: new Date().toISOString(),
				by: "customer",
				customerId,
				kind: "comment",
				comment: slot.customerComment,
			},
		];
		slot.updatedAt = new Date().toISOString();
		emitState();
	});

	socket.on("executor:hideUntouchedSlot", ({ slotId }) => {
		if (!isMaster()) return;
		const slot = state.slots[slotId];
		if (!slot) return;
		if (slot.touched) {
			socket.emit("error:message", "Можно скрывать только не редактированные слоты.");
			return;
		}
		if (isPastSlot(slot)) {
			socket.emit("error:message", "Прошедший слот скрывать нельзя.");
			return;
		}
		slot.hiddenByMaster = true;
		slot.updatedAt = new Date().toISOString();
		emitState();
	});

	socket.on("executor:updateWeekWorkDays", ({ weekStart, workDays }) => {
		if (!isMaster()) return;
		const weekDate = parseDateKey(weekStart);
		if (!weekDate) {
			socket.emit("error:message", "Некорректная неделя.");
			return;
		}

		const weekStartDate = startOfWeek(weekDate);
		const today = startOfDay(new Date());

		const safeDays = Array.isArray(workDays)
			? [...new Set(workDays.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))]
			: [];
		const weekKey = dateKey(weekStartDate);
		const prevDays = Array.isArray(state.weekWorkDays[weekKey]) ? state.weekWorkDays[weekKey] : [];
		const isPastWorkDay = (dayNum) => startOfDay(dateForWeekDay(weekStartDate, dayNum)) < today;
		const preservedPastDays = prevDays.filter((dayNum) => isPastWorkDay(dayNum));
		const editablePrevDays = prevDays.filter((dayNum) => !isPastWorkDay(dayNum));
		const editableNextDays = safeDays.filter((dayNum) => !isPastWorkDay(dayNum));

		// Days that are being removed
		const removedDays = editablePrevDays.filter((dayNum) => !editableNextDays.includes(dayNum));

		// Delete untouched slots from removed days
		if (removedDays.length > 0) {
			const daysToDelete = new Set();
			removedDays.forEach((dayNum) => {
				const d = dateForWeekDay(weekStartDate, dayNum);
				daysToDelete.add(dateKey(d));
			});

			Object.keys(state.slots).forEach((slotId) => {
				const slot = state.slots[slotId];
				if (daysToDelete.has(slot.datePart) && !slot.touched) {
					delete state.slots[slotId];
				}
			});
		}

		state.weekWorkDays[weekKey] = [...new Set([...preservedPastDays, ...editableNextDays])].sort((a, b) => a - b);
		ensureWeekSlots(weekKey);
		emitState();
	});

	socket.on("executor:updateWorkingHours", ({ startHour, endHour }) => {
		if (!isMaster()) return;
		const safeStart = Number(startHour);
		const safeEnd = Number(endHour);
		if (!Number.isInteger(safeStart) || !Number.isInteger(safeEnd)) {
			socket.emit("error:message", "Часы должны быть целыми числами.");
			return;
		}
		if (safeStart < 0 || safeStart > 23 || safeEnd < 1 || safeEnd > 24 || safeEnd <= safeStart) {
			socket.emit("error:message", "Некорректный диапазон рабочих часов.");
			return;
		}
		state.settings.startHour = safeStart;
		state.settings.endHour = safeEnd;
		syncSlotsForWorkingHours();
		emitState();
	});
});

function requireMasterAuth(req, res, next) {
	if (req.session && req.session.isMaster) return next();
	res.redirect("/login");
}

app.get("/login", (req, res) => {
	if (req.session && req.session.isMaster) return res.redirect("/master");
	res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.post("/login", (req, res) => {
	const { email, password } = req.body;
	const { email: MASTER_EMAIL, password: MASTER_PASSWORD } = getMasterCredentials();
	if (
		typeof email === "string" && typeof password === "string" &&
		email.trim().toLowerCase() === MASTER_EMAIL.trim().toLowerCase() &&
		password === MASTER_PASSWORD
	) {
		req.session.isMaster = true;
		persistMasterRememberCookie(res);
		return res.redirect("/master");
	}
	res.redirect("/login?error=1");
});

app.post("/logout", (req, res) => {
	res.clearCookie(MASTER_REMEMBER_COOKIE_NAME, {
		path: "/",
		httpOnly: true,
		sameSite: "lax",
		secure: process.env.NODE_ENV === "production",
	});
	req.session.destroy(() => res.redirect("/login"));
});

app.get("/master", requireMasterAuth, (req, res) => {
	res.sendFile(path.join(__dirname, "public", "master.html"));
});

app.use(express.static(path.join(__dirname, "public")));

server.listen(PORT, () => {
	// eslint-disable-next-line no-console
	console.log(`Server started on http://localhost:${PORT}`);
});
