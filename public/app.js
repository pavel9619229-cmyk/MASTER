const socket = io();

const calendarWrapper = document.getElementById("calendar-wrapper");
const hint = document.getElementById("hint");
const customerNameInput = document.getElementById("customerName");
const customerPhoneInput = document.getElementById("customerPhone");
const settingsForm = document.getElementById("settings-form");
const weekPrevBtn = document.getElementById("week-prev");
const weekNextBtn = document.getElementById("week-next");
const weekLabel = document.getElementById("week-label");
const viewDayBtn = document.getElementById("view-day");
const viewWeekBtn = document.getElementById("view-week");
const viewMonthBtn = document.getElementById("view-month");
const monthNavEl = document.getElementById("month-nav");
const monthPrevBtn = document.getElementById("month-prev");
const monthNextBtn = document.getElementById("month-next");
const monthLabelEl = document.getElementById("month-label");
const workStartHourInput = document.getElementById("work-start-hour");
const workEndHourInput = document.getElementById("work-end-hour");
const saveWorkHoursBtn = document.getElementById("save-work-hours");

const WEEKDAY_LABELS = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
const PHONE_PREFIX = "+7";

let role = (typeof window !== "undefined" && window.PAGE_ROLE) ? window.PAGE_ROLE : "customer";
let appState = { settings: { slotMinutes: 15 }, slots: {}, meta: {}, weekWorkDays: {} };
let currentWeekStart = startOfWeek(new Date());
let currentDay = startOfDay(new Date());
let currentView = "week";
let currentMonthStart = startOfMonth(new Date());
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

function startOfMonth(date) {
	return new Date(date.getFullYear(), date.getMonth(), 1);
}

const MONTH_NAMES = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];

function monthLabelText(date) {
	return `${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
}

function weekdayToWeekOffset(dayNum) {
	return (Number(dayNum) + 6) % 7;
}

function dateForWeekDay(weekStartDate, dayNum) {
	return addDays(weekStartDate, weekdayToWeekOffset(dayNum));
}

function toDisplayDate(date) {
	return `${WEEKDAY_LABELS[date.getDay()]}, ${pad(date.getDate())}.${pad(date.getMonth() + 1)}`;
}

function weekLabelText(weekStart) {
	const end = addDays(weekStart, 6);
	return `${pad(weekStart.getDate())}.${pad(weekStart.getMonth() + 1)} - ${pad(end.getDate())}.${pad(end.getMonth() + 1)}`;
}

function dayLabelText(day) {
	return `${toDisplayDate(day)}.${day.getFullYear()}`;
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

function clampDayToRange() {
	const rangeStart = parseDateKey(appState.meta?.rangeStart) || startOfDay(new Date());
	const rangeEnd = parseDateKey(appState.meta?.rangeEnd) || addDays(rangeStart, 28);
	const minDay = startOfDay(rangeStart);
	const maxDay = startOfDay(rangeEnd);
	if (currentDay < minDay) currentDay = minDay;
	if (currentDay > maxDay) currentDay = maxDay;
	currentWeekStart = startOfWeek(currentDay);
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
	const todayStart = startOfDay(currentNow());
	let days = currentView === "day"
		? [startOfDay(currentDay)]
		: Array.from({ length: 7 }, (_, i) => addDays(currentWeekStart, i));
	if (currentView !== "day" && role === "customer") {
		days = days.filter((d) => startOfDay(d) >= todayStart);
	}
	if (days.length === 0) {
		calendarWrapper.innerHTML = "<p>Нет доступных дней на этой неделе.</p>";
		return;
	}
	const dayKeys = days.map(dateKey);
	const dayStartKey = dayKeys[0];
	const dayEndKey = dayKeys[dayKeys.length - 1];
	const visibleSlots = Object.values(appState.slots || {}).filter((slot) => slot.datePart >= dayStartKey && slot.datePart <= dayEndKey);
	if (visibleSlots.length === 0) {
		calendarWrapper.innerHTML = "<p>Нет слотов на выбранный период.</p>";
		return;
	}

	const times = getTimesFromSettings();

	const grouped = {};
	visibleSlots.forEach((slot) => {
		if (!grouped[slot.baseKey]) grouped[slot.baseKey] = [];
		grouped[slot.baseKey].push(slot);
	});
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
			const isPastDay = !!(dayDate && startOfDay(dayDate) < todayStart);
			const weekKey = dateKey(currentWeekStart);
			const weekWorkDays = Array.isArray(appState.weekWorkDays?.[weekKey]) ? appState.weekWorkDays[weekKey] : [];
			const isWorkDay = !!(dayDate && weekWorkDays.includes(dayDate.getDay()));

			if (role === "customer" && isPastDay) {
				if (!isWorkDay) return '<td class="non-working-day non-working-day-past"></td>';
				return "<td></td>";
			}
			const key = `${dayKey}T${time}`;
			const slotsInCell = (grouped[key] || [])
				.filter((slot) => !(role === "customer" && isPastSlot(slot)))
				.sort((a, b) => a.id.localeCompare(b.id));
			const isRemovedWorkingCell = dayDate && isWorkDay && !isPastDay && slotsInCell.length === 0;

			if (dayDate && !isWorkDay && slotsInCell.length === 0) {
				return `<td class="non-working-day${isPastDay ? " non-working-day-past" : ""}"></td>`;
			}

			if (isRemovedWorkingCell) {
				return '<td class="non-working-day"></td>';
			}

			if (slotsInCell.length === 0) return "<td></td>";

			const slotsHtml = slotsInCell.map((slot) => {
				const past = isPastSlot(slot);
				const draftStatus = role === "executor"
					? (executorDraftStatuses[slot.id] || normalizeStatus(slot.status))
					: (customerDraftStatuses[slot.id] || normalizeStatus(slot.status));
				const clickable = canClickSlot({ ...slot, status: draftStatus });
				const canHideUntouched = role === "executor" && !past && !slot.touched;
				const hideBtnHtml = canHideUntouched
					? `<button type="button" class="slot-hide-btn" data-delete-slot="${slot.id}" title="Сделать слот нерабочим">×</button>`
					: "";
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
					<div class="slot-cell ${past ? "past-slot" : ""}">
						${hideBtnHtml}
						<div class="slot-row">
							<button
								class="slot ${draftStatus} ${clickable ? "clickable" : ""}"
								data-slot-id="${slot.id}"
								${clickable ? "" : "disabled"}
								>
								<span class="slot-label">${getStatusLabel(draftStatus)}</span>
							</button>
							${confirmBtnHtml}
						</div>
						${commentHtml}
						${historyHtml}
					</div>
				`;
			}).join("");

			const hasPastSlot = slotsInCell.some((s) => isPastSlot(s));
			return `<td class="${hasPastSlot ? "past-slot-cell" : ""}">${slotsHtml}</td>`;
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

	calendarWrapper.querySelectorAll("[data-delete-slot]").forEach((btn) => {
		btn.addEventListener("click", (e) => {
			e.preventDefault();
			e.stopPropagation();
			if (role !== "executor") return;
			const slotId = btn.getAttribute("data-delete-slot");
			if (!slotId || !appState.slots[slotId]) return;
			socket.emit("executor:hideUntouchedSlot", { slotId });
			setHint("Слот скрыт. Чтобы вернуть его, выключите и снова включите рабочий день.");
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
	clampDayToRange();

	const rangeStartRaw = parseDateKey(appState.meta?.rangeStart) || currentWeekStart;
	const rangeEndRaw = parseDateKey(appState.meta?.rangeEnd) || currentWeekStart;
	const rangeStartWeek = startOfWeek(rangeStartRaw);
	const rangeEndWeek = startOfWeek(rangeEndRaw);
	const rangeStartDay = startOfDay(rangeStartRaw);
	const rangeEndDay = startOfDay(rangeEndRaw);

	if (currentView === "day") {
		if (weekLabel) weekLabel.textContent = dayLabelText(currentDay);
		if (weekPrevBtn) {
			weekPrevBtn.textContent = "← День";
			const minDayForPrev = role === "customer" ? startOfDay(currentNow()) : rangeStartDay;
			weekPrevBtn.disabled = currentDay <= rangeStartDay || currentDay <= minDayForPrev;
		}
		if (weekNextBtn) {
			weekNextBtn.textContent = "День →";
			weekNextBtn.disabled = currentDay >= rangeEndDay;
		}
	} else {
		if (weekLabel) weekLabel.textContent = weekLabelText(currentWeekStart);
		if (weekPrevBtn) {
			weekPrevBtn.textContent = "← Неделя";
			weekPrevBtn.disabled = currentWeekStart <= rangeStartWeek;
		}
		if (weekNextBtn) {
			weekNextBtn.textContent = "Неделя →";
			weekNextBtn.disabled = currentWeekStart >= rangeEndWeek;
		}
	}

	if (role === "executor" && settingsForm) {
		const wk = dateKey(currentWeekStart);
		const selected = Array.isArray(appState.weekWorkDays?.[wk]) ? appState.weekWorkDays[wk] : [];
		const todayStart = startOfDay(currentNow());

		if (workStartHourInput) workStartHourInput.value = String(appState.settings?.startHour ?? 9);
		if (workEndHourInput) workEndHourInput.value = String(appState.settings?.endHour ?? 18);
		
		settingsForm.querySelectorAll('input[name="workDay"]').forEach((el) => {
			el.checked = selected.includes(Number(el.value));
			
			// Disable checkboxes for past days
			const dayDate = dateForWeekDay(currentWeekStart, Number(el.value));
			const isPastDay = startOfDay(dayDate) < todayStart;
			el.disabled = isPastDay;
			el.closest(".day-label").style.opacity = isPastDay ? "0.5" : "1";
		});
	}
}

function updateViewUI() {
	const isDay = currentView === "day";
	const isWeek = currentView === "week";
	const isMonth = currentView === "month";
	if (viewDayBtn) viewDayBtn.classList.toggle("active", isDay);
	if (viewWeekBtn) viewWeekBtn.classList.toggle("active", isWeek);
	if (viewMonthBtn) viewMonthBtn.classList.toggle("active", isMonth);
	const weekNavEl = document.getElementById("week-nav");
	if (weekNavEl) weekNavEl.classList.toggle("hidden", isMonth);
	if (monthNavEl) monthNavEl.classList.toggle("hidden", !isMonth);
	if (monthLabelEl) monthLabelEl.textContent = monthLabelText(currentMonthStart);
}

function renderView() {
	if (currentView === "month") {
		renderMonthView();
	} else {
		renderCalendar();
	}
}

function renderMonthView() {
	const monthStart = currentMonthStart;
	const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
	const gridStart = startOfWeek(monthStart);
	const gridEnd = addDays(startOfWeek(monthEnd), 6);
	const todayStart = startOfDay(currentNow());

	const slotsByDay = {};
	Object.values(appState.slots || {}).forEach((slot) => {
		if (!slotsByDay[slot.datePart]) slotsByDay[slot.datePart] = [];
		slotsByDay[slot.datePart].push(slot);
	});

	const thead = `<thead><tr>${["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((d) => `<th>${d}</th>`).join("")}</tr></thead>`;

	let rowsHtml = "";
	let day = new Date(gridStart);
	while (day <= gridEnd) {
		rowsHtml += "<tr>";
		for (let i = 0; i < 7; i++) {
			const dk = dateKey(day);
			const isCurrentMonth = day.getMonth() === monthStart.getMonth();
			const isPast = startOfDay(day) < todayStart;
			const isToday = startOfDay(day).getTime() === todayStart.getTime();

			const wk = dateKey(startOfWeek(day));
			const weekWorkDays = Array.isArray(appState.weekWorkDays?.[wk]) ? appState.weekWorkDays[wk] : [];
			const isWorkDay = weekWorkDays.includes(day.getDay());

			const daySlots = (slotsByDay[dk] || []).filter((s) => !(role === "customer" && isPastSlot(s)));
			const uniqueStatuses = [...new Set(daySlots.map((s) => normalizeStatus(s.status)))].slice(0, 4);
			const dotsHtml = uniqueStatuses.length > 0
				? `<div class="month-day-dots">${uniqueStatuses.map((st) => `<span class="month-dot ${st}"></span>`).join("")}</div>`
				: "";

			const classes = [
				"month-day",
				isCurrentMonth ? "" : "other-month",
				isPast && !isToday ? "past-day" : "",
				isToday ? "today" : "",
				isWorkDay ? "work-day" : "",
				!isWorkDay ? "non-work-day" : "",
			].filter(Boolean).join(" ");

			rowsHtml += `<td class="${classes}" data-day-key="${dk}"><span class="month-day-num">${day.getDate()}</span>${dotsHtml}</td>`;
			day = addDays(day, 1);
		}
		rowsHtml += "</tr>";
	}

	calendarWrapper.innerHTML = `<table class="month-calendar">${thead}<tbody>${rowsHtml}</tbody></table>`;

	calendarWrapper.querySelectorAll(".month-day").forEach((td) => {
		td.addEventListener("click", () => {
			const clickedDay = parseDateKey(td.getAttribute("data-day-key"));
			if (!clickedDay) return;
			currentDay = startOfDay(clickedDay);
			currentWeekStart = startOfWeek(clickedDay);
			currentView = "week";
			updateViewUI();
			renderWeekControls();
			renderCalendar();
		});
	});
}

if (weekPrevBtn) {
	weekPrevBtn.addEventListener("click", () => {
		if (currentView === "day") {
			currentDay = addDays(currentDay, -1);
			currentWeekStart = startOfWeek(currentDay);
		} else {
			currentWeekStart = addDays(currentWeekStart, -7);
			currentDay = startOfDay(currentWeekStart);
		}
		renderWeekControls();
		renderCalendar();
	});
}

if (weekNextBtn) {
	weekNextBtn.addEventListener("click", () => {
		if (currentView === "day") {
			currentDay = addDays(currentDay, 1);
			currentWeekStart = startOfWeek(currentDay);
		} else {
			currentWeekStart = addDays(currentWeekStart, 7);
			currentDay = startOfDay(currentWeekStart);
		}
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
		setHint("Рабочие дни сохранены.");
	});
}

if (saveWorkHoursBtn) {
	saveWorkHoursBtn.addEventListener("click", () => {
		if (role !== "executor") return;
		const startHour = Number(workStartHourInput ? workStartHourInput.value : appState.settings?.startHour ?? 9);
		const endHour = Number(workEndHourInput ? workEndHourInput.value : appState.settings?.endHour ?? 18);
		socket.emit("executor:updateWorkingHours", {
			startHour,
			endHour,
		});
		setHint("Рабочие часы сохранены.");
	});
}

socket.on("state", (nextState) => {
	appState = nextState;
	executorDraftStatuses = {};
	customerDraftStatuses = {};
	executorDraftComments = {};
	customerDraftComments = {};
	updateViewUI();
	renderWeekControls();
	renderView();
});

socket.on("error:message", (message) => {
	setHint(message);
});

if (viewDayBtn) {
	viewDayBtn.addEventListener("click", () => {
		currentView = "day";
		currentDay = startOfDay(currentDay);
		if (role === "customer") {
			const todaySnap = startOfDay(currentNow());
			if (currentDay < todaySnap) currentDay = todaySnap;
		}
		currentWeekStart = startOfWeek(currentDay);
		updateViewUI();
		renderWeekControls();
		renderCalendar();
	});
}

if (viewWeekBtn) {
	viewWeekBtn.addEventListener("click", () => {
		currentView = "week";
		currentWeekStart = startOfWeek(currentDay);
		updateViewUI();
		renderWeekControls();
		renderCalendar();
	});
}

if (viewMonthBtn) {
	viewMonthBtn.addEventListener("click", () => {
		currentView = "month";
		currentMonthStart = startOfMonth(currentWeekStart);
		updateViewUI();
		renderMonthView();
	});
}

if (monthPrevBtn) {
	monthPrevBtn.addEventListener("click", () => {
		currentMonthStart = new Date(currentMonthStart.getFullYear(), currentMonthStart.getMonth() - 1, 1);
		if (monthLabelEl) monthLabelEl.textContent = monthLabelText(currentMonthStart);
		renderMonthView();
	});
}

if (monthNextBtn) {
	monthNextBtn.addEventListener("click", () => {
		currentMonthStart = new Date(currentMonthStart.getFullYear(), currentMonthStart.getMonth() + 1, 1);
		if (monthLabelEl) monthLabelEl.textContent = monthLabelText(currentMonthStart);
		renderMonthView();
	});
}

if (customerPhoneInput && !customerPhoneInput.value.trim()) {
	customerPhoneInput.value = PHONE_PREFIX;
}

setHint(role === "executor"
	? "Мастер: переключайте недели, добавляйте рабочие дни и подтверждайте слоты."
	: "Клиент: доступны только следующие 4 недели.");
