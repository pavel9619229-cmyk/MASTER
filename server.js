const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const DAYS_TO_SHOW = 7;
const ALL_WEEK_DAYS = [0, 1, 2, 3, 4, 5, 6];

const state = {
	settings: {
		startHour: 9,
		endHour: 18,
		slotMinutes: 30,
		workDays: [1, 2, 3, 4, 5],
	},
	slots: {},
};

function pad(num) {
	return String(num).padStart(2, "0");
}

function dateKey(date) {
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function makeSlotId(datePart, hour, minute) {
	return `${datePart}T${pad(hour)}:${pad(minute)}`;
}

function buildWeekDates() {
	const days = [];
	const now = new Date();
	const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());

	for (let i = 0; i < DAYS_TO_SHOW; i += 1) {
		const d = new Date(start);
		d.setDate(start.getDate() + i);
		days.push(d);
	}

	return days;
}

function buildSlots(settings) {
	const { startHour, endHour, slotMinutes, workDays = [1, 2, 3, 4, 5] } = settings;
	const slots = {};
	const dates = buildWeekDates();

	for (const day of dates) {
		if (!workDays.includes(day.getDay())) {
			continue;
		}

		const dayId = dateKey(day);
		let totalMinutes = startHour * 60;
		const endMinutes = endHour * 60;

		while (totalMinutes + slotMinutes <= endMinutes) {
			const hour = Math.floor(totalMinutes / 60);
			const minute = totalMinutes % 60;
			const slotId = makeSlotId(dayId, hour, minute);

			slots[slotId] = {
				status: "free",
				customerName: "",
				customerPhone: "",
				updatedAt: new Date().toISOString(),
			};

			totalMinutes += slotMinutes;
		}
	}

	return slots;
}

function validateSettings(next) {
	const startHour = Number(next.startHour);
	const endHour = Number(next.endHour);
	const slotMinutes = Number(next.slotMinutes);
	const workDays = Array.isArray(next.workDays)
		? next.workDays.map(Number)
		: Array.isArray(next.offDays)
			? ALL_WEEK_DAYS.filter((d) => !next.offDays.map(Number).includes(d))
			: [1, 2, 3, 4, 5];

	if (!Number.isInteger(startHour) || !Number.isInteger(endHour) || !Number.isInteger(slotMinutes)) {
		return { ok: false, error: "Параметры должны быть целыми числами." };
	}

	if (startHour < 0 || endHour > 24 || startHour >= endHour) {
		return { ok: false, error: "Проверьте начало и конец рабочего дня." };
	}

	if (![15, 30, 60].includes(slotMinutes)) {
		return { ok: false, error: "Длительность слота: 15, 30 или 60 минут." };
	}

	if (workDays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
		return { ok: false, error: "Некорректные рабочие дни." };
	}

	if (workDays.length === 0) {
		return { ok: false, error: "Выберите хотя бы один рабочий день." };
	}

	return { ok: true, value: { startHour, endHour, slotMinutes, workDays } };
}

function normalizeStatus(status) {
	return status === "busy" ? "rejected" : status;
}

function isValidCustomerPhone(phone) {
	const digitsOnly = String(phone).replace(/\D/g, "");
	return digitsOnly.length >= 10;
}

function emitState() {
	io.emit("state", state);
}

state.slots = buildSlots(state.settings);

io.on("connection", (socket) => {
	socket.emit("state", state);

	socket.on("customer:clickSlot", ({ slotId, customerName, customerPhone }) => {
		if (!slotId || !state.slots[slotId]) {
			return;
		}

		const currentStatus = normalizeStatus(state.slots[slotId].status);
		if (currentStatus !== "free" && currentStatus !== "requested") {
			return;
		}

		if (currentStatus === "free") {
			const safeName = String(customerName || "").trim();
			const safePhone = String(customerPhone || "").trim();
			if (!safeName || !safePhone || !isValidCustomerPhone(safePhone)) {
				socket.emit("error:message", "Для подачи заявки заполните имя и корректный номер телефона КЛИЕНТА.");
				return;
			}

			state.slots[slotId] = {
				...state.slots[slotId],
				status: "requested",
				customerName: safeName,
				customerPhone: safePhone,
				updatedAt: new Date().toISOString(),
			};
		} else {
			state.slots[slotId] = {
				...state.slots[slotId],
				status: "free",
				customerName: "",
				customerPhone: "",
				updatedAt: new Date().toISOString(),
			};
		}

		emitState();
	});

	socket.on("executor:clickSlot", ({ slotId }) => {
		if (!slotId || !state.slots[slotId]) {
			return;
		}

		const currentStatus = normalizeStatus(state.slots[slotId].status);
		let nextStatus;

		if (currentStatus === "requested") {
			nextStatus = "confirmed";
		} else if (currentStatus === "free") {
			nextStatus = "confirmed";
		} else if (currentStatus === "confirmed") {
			nextStatus = "rejected";
		} else if (currentStatus === "rejected") {
			nextStatus = "free";
		} else {
			return;
		}

		state.slots[slotId] = {
			...state.slots[slotId],
			status: nextStatus,
			updatedAt: new Date().toISOString(),
		};

		if (nextStatus === "free") {
			state.slots[slotId].customerName = "";
			state.slots[slotId].customerPhone = "";
		}

		emitState();
	});

	socket.on("executor:updateSettings", (nextSettings) => {
		const validated = validateSettings(nextSettings);
		if (!validated.ok) {
			socket.emit("error:message", validated.error);
			return;
		}

		state.settings = validated.value;
		state.slots = buildSlots(state.settings);
		emitState();
	});
});

app.use(express.static(path.join(__dirname, "public")));

server.listen(PORT, () => {
	// eslint-disable-next-line no-console
	console.log(`Server started on http://localhost:${PORT}`);
});
