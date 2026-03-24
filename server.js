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
		startHour: 12,
		endHour: 14,
		slotMinutes: 60,
		workDays: [2, 5],
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

function emitState() {
	io.emit("state", state);
}

state.slots = buildSlots(state.settings);

io.on("connection", (socket) => {
	socket.emit("state", state);

	socket.on("customer:confirmSlot", ({ slotId, selectedStatus, customerName, customerPhone }) => {
		if (!slotId || !state.slots[slotId]) {
			return;
		}

		const normalizedSelected = normalizeStatus(selectedStatus);
		if (normalizedSelected !== "requested" && normalizedSelected !== "free") {
			return;
		}

		if (normalizedSelected === "requested") {
			const safeName = String(customerName || "").trim();
			const safePhone = String(customerPhone || "").trim();

			state.slots[slotId].status = "requested";
			state.slots[slotId].customerName = safeName || state.slots[slotId].customerName || "";
			state.slots[slotId].customerPhone = safePhone || state.slots[slotId].customerPhone || "";
		} else {
			state.slots[slotId].status = "free";
			state.slots[slotId].customerName = "";
			state.slots[slotId].customerPhone = "";
		}

		state.slots[slotId].history = [
			...(state.slots[slotId].history || []),
			{
				at: new Date().toISOString(),
				by: "customer",
				toStatus: state.slots[slotId].status,
				customerName: state.slots[slotId].customerName || "",
				customerPhone: state.slots[slotId].customerPhone || "",
			},
		];
		state.slots[slotId].updatedAt = new Date().toISOString();
		emitState();
	});

	socket.on("executor:confirmSlot", ({ slotId, selectedStatus }) => {
		if (!slotId || !state.slots[slotId]) {
			return;
		}
		const allowedStatuses = ["free", "requested", "confirmed", "rejected"];
		const normalizedSelected = normalizeStatus(selectedStatus);
		const confirmedStatus = allowedStatuses.includes(normalizedSelected)
			? normalizedSelected
			: normalizeStatus(state.slots[slotId].status);

		state.slots[slotId].status = confirmedStatus;
		state.slots[slotId].history = [
			...(state.slots[slotId].history || []),
			{ at: new Date().toISOString(), by: "executor", toStatus: confirmedStatus },
		];
		if (confirmedStatus === "free") {
			state.slots[slotId].customerName = "";
			state.slots[slotId].customerPhone = "";
		}
		state.slots[slotId].updatedAt = new Date().toISOString();
		emitState();
	});

	socket.on("executor:setComment", ({ slotId, comment }) => {
		if (!slotId || !state.slots[slotId]) {
			return;
		}
		const safeComment = String(comment || "").trim().slice(0, 300);
		state.slots[slotId].comment = safeComment;
		state.slots[slotId].history = [
			...(state.slots[slotId].history || []),
			{
				at: new Date().toISOString(),
				by: "executor",
				kind: "comment",
				comment: safeComment,
			},
		];
		state.slots[slotId].updatedAt = new Date().toISOString();
		emitState();
	});

	socket.on("customer:setComment", ({ slotId, comment }) => {
		if (!slotId || !state.slots[slotId]) {
			return;
		}
		const safeComment = String(comment || "").trim().slice(0, 300);
		state.slots[slotId].customerComment = safeComment;
		state.slots[slotId].history = [
			...(state.slots[slotId].history || []),
			{
				at: new Date().toISOString(),
				by: "customer",
				kind: "comment",
				comment: safeComment,
			},
		];
		state.slots[slotId].updatedAt = new Date().toISOString();
		emitState();
	});
});

app.use(express.static(path.join(__dirname, "public")));

server.listen(PORT, () => {
	// eslint-disable-next-line no-console
	console.log(`Server started on http://localhost:${PORT}`);
});
