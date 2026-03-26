const socket = io();

const calendarWrapper = document.getElementById("calendar-wrapper");
const hint = document.getElementById("hint");
const customerNameInput = document.getElementById("customerName");
const customerPhoneInput = document.getElementById("customerPhone");
const settingsForm = document.getElementById("settings-form");
const weekPrevBtn = document.getElementById("week-prev");
const weekNextBtn = document.getElementById("week-next");
const weekLabel = document.getElementById("week-label");

const WEEKDAY_LABELS = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
const PHONE_PREFIX = "+7";

let role = (typeof window !== "undefined" && window.PAGE_ROLE) ? window.PAGE_ROLE : "customer";
let appState = { settings: { slotMinutes: 15 }, slots: {}, meta: {}, weekWorkDays: {} };
let currentWeekStart = startOfWeek(new Date());
let executorDraftStatuses = {};
let customerDraftStatuses = {};
let executorDraftComments = {};
let customerDraftComments = {};

function setHint(text) {
	if (hint) hint.textContent = text;
}

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

function addDays(date, n) {
	const d = new Date(date);
	d.setDate(d.getDate() + n);
	return d;
}

function startOfWeek(date) {
	const d = startOfDay(date);
	const day = (d.getDay() + 6) % 7;
	d.setDate(d.getDate() - day);
	return d;
}

function toDisplayDate(date) {
	return `${WEEKDAY_LABELS[date.getDay()]}, ${pad(date.getDate())}.${pad(date.getMonth() + 1)}`;
}

function weekLabelText(weekStart) {
	const end = addDays(weekStart, 6);
	return `${pad(weekStart.getDate())}.${pad(weekStart.getMonth() + 1)} - ${pad(end.getDate())}.${pad(end.getMonth() + 1)}`;
}

function currentNow() {
	return appState.meta?.nowIso ? new Date(appState.meta.nowIso) : new Date();
}

function slotDateTime(slot) {
	const day = parseDateKey(slot.datePart);
	if (!day) return null;
	const [h, m] = String(slot.timePart || "00:00").split(":").map(Number);
	return new Date(day.getFullYear(), day.getMonth(), day.getDate(), Number(h) || 0, Number(m) || 0, 0, 0);
}

function isPastSlot(slot) {
	const dt = slotDateTime(slot);
	if (!dt) return false;
	return dt.getTime() < currentNow().getTime();
}

function clampWeekToRange() {
	const rangeStart = parseDateKey(appState.meta?.rangeStart) || startOfWeek(new Date());
	const rangeEnd = parseDateKey(appState.meta?.rangeEnd) || addDays(rangeStart, 28);
	const minWeek = startOfWeek(rangeStart);
	const maxWeek = startOfWeek(rangeEnd);
	if (currentWeekStart < minWeek) currentWeekStart = minWeek;
	if (currentWeekStart > maxWeek) currentWeekStart = maxWeek;
}

function normalizeStatus(status) {
	return status === "busy" ? "rejected" : status;
}

function getStatusLabel(status) {
	const normalized = normalizeStatus(status);
	if (normalized === "free") return "свободно";
	if (normalized === "requested") return "запрос";
	if (normalized === "confirmed") return "подтверждено";
	if (normalized === "split") return "частично";
	return "занято";
}

function canClickSlot(slot) {
	const normalized = normalizeStatus(slot.status);
	if (isPastSlot(slot)) return false;
	if (role === "customer") {
		return normalized === "free" || normalized === "requested";
	}
	return ["free", "requested", "confirmed", "rejected", "split"].includes(normalized);
}

function nextExecutorStatus(currentStatus) {
	const normalized = normalizeStatus(currentStatus);
	if (normalized === "requested") return "confirmed";
	if (normalized === "confirmed") return "split";
	if (normalized === "split") return "rejected";
	if (normalized === "rejected") return "free";
	return "confirmed";
}

function nextCustomerStatus(currentStatus) {
	const normalized = normalizeStatus(currentStatus);
	if (normalized === "requested") return "free";
	return "requested";
}

function normalizeCustomerPhoneInput(value) {
	const digitsOnly = String(value || "").replace(/\D/g, "");
	if (digitsOnly.startsWith("7") || digitsOnly.startsWith("8")) {
		return `${PHONE_PREFIX}${digitsOnly.slice(1)}`;
	}
	return `${PHONE_PREFIX}${digitsOnly}`;
}

function handleSlotClick(slot) {
	if (!canClickSlot(slot)) return;

	if (role === "customer") {
		const currentDraft = customerDraftStatuses[slot.id] || normalizeStatus(slot.status);
		customerDraftStatuses[slot.id] = nextCustomerStatus(currentDraft);
		renderCalendar();
		setHint("Клиент: выбран черновой статус, нажмите Подтвердить.");
		return;
	}

	const currentDraft = executorDraftStatuses[slot.id] || normalizeStatus(slot.status);
	executorDraftStatuses[slot.id] = nextExecutorStatus(currentDraft);
	renderCalendar();
	setHint("Мастер: выбран черновой статус, нажмите Подтвердить.");
}

function getVisibleSlotsForWeek() {
	const slots = Object.values(appState.slots || {});
	const weekStartKey = dateKey(currentWeekStart);
	const weekEndKey = dateKey(addDays(currentWeekStart, 6));
	return slots.filter((slot) => slot.datePart >= weekStartKey && slot.datePart <= weekEndKey);
}

function getTimesFromSettings() {
	const out = [];
	const start = Number(appState.settings?.startHour ?? 9) * 60;
	const end = Number(appState.settings?.endHour ?? 18) * 60;
	const step = Number(appState.settings?.slotMinutes ?? 15);
	for (let t = start; t + step <= end; t += step) {
		out.push(`${pad(Math.floor(t / 60))}:${pad(t % 60)}`);
	}
	return out;
}

function historyEntryText(entry) {
	const time = entry?.at ? `${pad(new Date(entry.at).getHours())}:${pad(new Date(entry.at).getMinutes())}` : "";
	if (entry.kind === "comment") {
		if (entry.by === "executor") return `${time} — мастер: ${entry.comment || ""}`;
		return `${time} — клиент: ${entry.comment || ""}`;
	}
	if (entry.by === "executor") return `${time} — мастер: ${getStatusLabel(entry.toStatus || "")}`;
	return `${time} — клиент: ${getStatusLabel(entry.toStatus || "")}`;
}

function hasStatusDraftChange(slot) {
	const persisted = normalizeStatus(slot.status);
	if (role === "executor") {
		if (!Object.prototype.hasOwnProperty.call(executorDraftStatuses, slot.id)) return false;
		return executorDraftStatuses[slot.id] !== persisted;
	}
	if (!Object.prototype.hasOwnProperty.call(customerDraftStatuses, slot.id)) return false;
	return customerDraftStatuses[slot.id] !== persisted;
}

function getPersistedComment(slot, commentBy) {
	return commentBy === "executor" ? String(slot.comment || "") : String(slot.customerComment || "");
}

function getDraftComment(slot, commentBy) {
	const drafts = commentBy === "executor" ? executorDraftComments : customerDraftComments;
	return Object.prototype.hasOwnProperty.call(drafts, slot.id)
		? drafts[slot.id]
		: getPersistedComment(slot, commentBy);
}

function hasCommentDraftChange(slot, commentBy) {
	return getDraftComment(slot, commentBy) !== getPersistedComment(slot, commentBy);
}

function renderCalendar() {
	const visibleSlots = getVisibleSlotsForWeek();
	if (visibleSlots.length === 0) {
		calendarWrapper.innerHTML = "<p>Нет слотов на выбранную неделю.</p>";
		return;
	}

	const days = Array.from({ length: 7 }, (_, i) => addDays(currentWeekStart, i));
	const dayKeys = days.map(dateKey);
	const times = getTimesFromSettings();

	const grouped = {};
	visibleSlots.forEach((slot) => {
		if (!grouped[slot.baseKey]) grouped[slot.baseKey] = [];
		grouped[slot.baseKey].push(slot);
	});

	const todayStart = startOfDay(currentNow());
	const thead = `
		<thead>
			<tr>
				<th>Время</th>
				${days.map((d) => {
					if (role === "customer" && startOfDay(d) < todayStart) return "<th></th>";
					return `<th>${toDisplayDate(d)}</th>`;
				}).join("")}
			</tr>
		</thead>
	`;

	const rows = times.map((time) => {
		const cells = dayKeys.map((dayKey) => {
			const dayDate = parseDateKey(dayKey);
			if (role === "customer" && dayDate && startOfDay(dayDate) < todayStart) {
				return "<td></td>";
			}
			const key = `${dayKey}T${time}`;
			const slotsInCell = (grouped[key] || [])
				.filter((slot) => !(role === "customer" && isPastSlot(slot)))
				.sort((a, b) => a.id.localeCompare(b.id));
			if (slotsInCell.length === 0) return "<td></td>";

			const slotsHtml = slotsInCell.map((slot) => {
				const past = isPastSlot(slot);
				const draftStatus = role === "executor"
					? (executorDraftStatuses[slot.id] || normalizeStatus(slot.status))
					: (customerDraftStatuses[slot.id] || normalizeStatus(slot.status));
				const clickable = canClickSlot({ ...slot, status: draftStatus });
				const confirmBtnHtml = !past && hasStatusDraftChange(slot)
					? `<button type="button" class="slot-confirm-btn" data-confirm-slot="${slot.id}">Подтвердить</button>`
					: "";

				let commentHtml = "";
				if (role === "executor" || role === "customer") {
					const commentBy = role === "executor" ? "executor" : "customer";
					const showSend = hasCommentDraftChange(slot, commentBy);
					commentHtml = `
						<form class="slot-comment-form" data-comment-slot="${slot.id}" data-comment-by="${commentBy}">
							<input class="slot-comment-input" maxlength="300" value="${getDraftComment(slot, commentBy).replace(/"/g, "&quot;")}" placeholder="Комментарий" />
							<button type="submit" class="slot-confirm-btn slot-comment-send-btn" ${showSend ? "" : "hidden"}>Отправить</button>
						</form>
					`;
				}

				const historyHtml = (slot.history || []).length > 0
					? `<ul class="slot-history">${slot.history.map((h) => `<li>${historyEntryText(h)}</li>`).join("")}</ul>`
					: "";

				return `
					<div class="slot-cell">
						<div class="slot-row">
							<button
								class="slot ${draftStatus} ${clickable ? "clickable" : ""}"
								data-slot-id="${slot.id}"
								${clickable ? "" : "disabled"}
								>
								<span class="slot-dot ${draftStatus}"></span>
								<span class="slot-label">${getStatusLabel(draftStatus)}</span>
							</button>
							${confirmBtnHtml}
						</div>
						${commentHtml}
						${historyHtml}
					</div>
				`;
			}).join("");

			return `<td>${slotsHtml}</td>`;
		}).join("");

		return `<tr><td class="time-label">${time}</td>${cells}</tr>`;
	}).join("");

	calendarWrapper.innerHTML = `<table class="calendar">${thead}<tbody>${rows}</tbody></table>`;

	calendarWrapper.querySelectorAll("[data-slot-id]").forEach((el) => {
		el.addEventListener("click", () => {
			const slot = appState.slots[el.getAttribute("data-slot-id")];
			if (slot) handleSlotClick(slot);
		});
	});

	calendarWrapper.querySelectorAll(".slot-confirm-btn[data-confirm-slot]").forEach((btn) => {
		btn.addEventListener("click", (e) => {
			e.preventDefault();
			const slotId = btn.getAttribute("data-confirm-slot");
			if (!slotId || !appState.slots[slotId]) return;
			if (role === "customer") {
				const selectedStatus = customerDraftStatuses[slotId] || normalizeStatus(appState.slots[slotId].status);
				socket.emit("customer:confirmSlot", {
					slotId,
					selectedStatus,
					customerName: customerNameInput ? customerNameInput.value.trim() : "",
					customerPhone: customerPhoneInput ? customerPhoneInput.value.trim() : "",
				});
				setHint("Запрос отправлен.");
				return;
			}
			const selectedStatus = executorDraftStatuses[slotId] || normalizeStatus(appState.slots[slotId].status);
			socket.emit("executor:confirmSlot", { slotId, selectedStatus });
			setHint("Статус обновлен.");
		});
	});

	calendarWrapper.querySelectorAll(".slot-comment-form").forEach((form) => {
		const slotId = form.getAttribute("data-comment-slot");
		const commentBy = form.getAttribute("data-comment-by");
		const input = form.querySelector(".slot-comment-input");
		const sendBtn = form.querySelector(".slot-comment-send-btn");
		if (!slotId || !commentBy || !input || !sendBtn || !appState.slots[slotId]) return;

		input.addEventListener("input", () => {
			if (commentBy === "executor") executorDraftComments[slotId] = input.value;
			if (commentBy === "customer") customerDraftComments[slotId] = input.value;
			sendBtn.hidden = !hasCommentDraftChange(appState.slots[slotId], commentBy);
		});

		form.addEventListener("submit", (e) => {
			e.preventDefault();
			if (commentBy === "executor") {
				socket.emit("executor:setComment", { slotId, comment: input.value });
			} else {
				socket.emit("customer:setComment", { slotId, comment: input.value });
			}
			setHint("Комментарий сохранен.");
		});
	});
}

function renderWeekControls() {
	clampWeekToRange();
	if (weekLabel) weekLabel.textContent = weekLabelText(currentWeekStart);

	const rangeStart = startOfWeek(parseDateKey(appState.meta?.rangeStart) || currentWeekStart);
	const rangeEnd = startOfWeek(parseDateKey(appState.meta?.rangeEnd) || currentWeekStart);

	if (weekPrevBtn) weekPrevBtn.disabled = currentWeekStart <= rangeStart;
	if (weekNextBtn) weekNextBtn.disabled = currentWeekStart >= rangeEnd;

	if (role === "executor" && settingsForm) {
		const wk = dateKey(currentWeekStart);
		const selected = Array.isArray(appState.weekWorkDays?.[wk]) ? appState.weekWorkDays[wk] : [];
		const todayStart = startOfDay(currentNow());
		
		settingsForm.querySelectorAll('input[name="workDay"]').forEach((el) => {
			el.checked = selected.includes(Number(el.value));
			
			// Disable checkboxes for past days
			const dayOffset = Number(el.value);
			const dayDate = addDays(currentWeekStart, dayOffset);
			const isPastDay = startOfDay(dayDate) < todayStart;
			el.disabled = isPastDay;
			el.closest(".day-label").style.opacity = isPastDay ? "0.5" : "1";
		});
	}
}

if (weekPrevBtn) {
	weekPrevBtn.addEventListener("click", () => {
		currentWeekStart = addDays(currentWeekStart, -7);
		renderWeekControls();
		renderCalendar();
	});
}

if (weekNextBtn) {
	weekNextBtn.addEventListener("click", () => {
		currentWeekStart = addDays(currentWeekStart, 7);
		renderWeekControls();
		renderCalendar();
	});
}

if (customerPhoneInput) {
	customerPhoneInput.addEventListener("focus", () => {
		if (!customerPhoneInput.value.trim()) customerPhoneInput.value = PHONE_PREFIX;
	});
	customerPhoneInput.addEventListener("input", () => {
		customerPhoneInput.value = normalizeCustomerPhoneInput(customerPhoneInput.value);
	});
}

if (settingsForm) {
	settingsForm.addEventListener("submit", (event) => {
		event.preventDefault();
		if (role !== "executor") return;
		const workDays = Array.from(settingsForm.querySelectorAll('input[name="workDay"]:checked')).map((el) => Number(el.value));
		socket.emit("executor:updateWeekWorkDays", {
			weekStart: dateKey(currentWeekStart),
			workDays,
		});
		setHint("Рабочие дни обновлены для выбранной недели.");
	});
}

socket.on("state", (nextState) => {
	appState = nextState;
	executorDraftStatuses = {};
	customerDraftStatuses = {};
	executorDraftComments = {};
	customerDraftComments = {};
	renderWeekControls();
	renderCalendar();
});

socket.on("error:message", (message) => {
	setHint(message);
});

if (customerPhoneInput && !customerPhoneInput.value.trim()) {
	customerPhoneInput.value = PHONE_PREFIX;
}

setHint(role === "executor"
	? "Мастер: переключайте недели, добавляйте рабочие дни и подтверждайте слоты."
	: "Клиент: доступны только следующие 4 недели.");
