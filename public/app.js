const socket = io();

const roleSelect = document.getElementById("role");
const calendarWrapper = document.getElementById("calendar-wrapper");
const hint = document.getElementById("hint");
const customerData = document.getElementById("customer-data");
const customerNameInput = document.getElementById("customerName");
const customerPhoneInput = document.getElementById("customerPhone");
const settingsForm = document.getElementById("settings-form");
const settingsSection = document.getElementById("settings-section");
const startHourInput = document.getElementById("startHour");
const endHourInput = document.getElementById("endHour");
const slotMinutesSelect = document.getElementById("slotMinutes");

const WEEKDAY_LABELS = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
const ALL_WEEK_DAYS = [0, 1, 2, 3, 4, 5, 6];
const PHONE_PREFIX = "+7";

let appState = {
	settings: {
		startHour: 9,
		endHour: 18,
		slotMinutes: 30,
		workDays: [1, 2, 3, 4, 5],
	},
	slots: {},
};

let role = "customer";

function setHint(text) {
	hint.textContent = text;
}

function pad(num) {
	return String(num).padStart(2, "0");
}

function formatTime(isoString) {
	const d = new Date(isoString);
	return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toDisplayDate(datePart) {
	const [year, month, day] = datePart.split("-").map(Number);
	const date = new Date(year, month - 1, day);
	return `${WEEKDAY_LABELS[date.getDay()]}, ${pad(day)}.${pad(month)}`;
}

function normalizeStatus(status) {
	return status === "busy" ? "rejected" : status;
}

function escapeHtml(value) {
	return String(value)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/\"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function historyEntryText(entry) {
	const time = formatTime(entry.at);
	if (entry.by === "customer") {
		if (entry.toStatus === "requested") {
			return `${time} — запрос: ${escapeHtml(entry.customerName || "")} | ${escapeHtml(entry.customerPhone || "")}`;
		}
		return `${time} — клиент отменил запрос`;
	}
	if (entry.toStatus === "confirmed") return `${time} — мастер подтвердил`;
	if (entry.toStatus === "rejected") return `${time} — мастер отклонил`;
	if (entry.toStatus === "free") return `${time} — мастер освободил слот`;
	return `${time} — ${escapeHtml(entry.toStatus)}`;
}

function getStatusLabel(status) {
	const normalized = normalizeStatus(status);
	if (normalized === "free") return "свободно";
	if (normalized === "requested") return "запрос";
	if (normalized === "confirmed") return "подтверждено";
	return "занято";
}

function canClickSlot(slotStatus) {
	const normalized = normalizeStatus(slotStatus);

	if (role === "customer") {
		return normalized === "free" || normalized === "requested";
	}

	if (role === "executor") {
		return normalized === "free" || normalized === "requested" || normalized === "confirmed" || normalized === "rejected";
	}

	return false;
}

function isValidCustomerPhone(phone) {
	const digitsOnly = phone.replace(/\D/g, "");
	return digitsOnly.length >= 10;
}

function normalizeCustomerPhoneInput(value) {
	const digitsOnly = String(value || "").replace(/\D/g, "");
	if (digitsOnly.startsWith("7")) {
		return `${PHONE_PREFIX}${digitsOnly.slice(1)}`;
	}
	if (digitsOnly.startsWith("8")) {
		return `${PHONE_PREFIX}${digitsOnly.slice(1)}`;
	}
	return `${PHONE_PREFIX}${digitsOnly}`;
}

function handleSlotClick(slotId, slotStatus) {
	if (!canClickSlot(slotStatus)) {
		return;
	}

	if (role === "customer") {
		const normalized = normalizeStatus(slotStatus);

		if (normalized === "free") {
			const customerName = customerNameInput.value.trim();
			const customerPhone = customerPhoneInput.value.trim();

			if (!customerName || !customerPhone) {
				setHint("Чтобы подать заявку, укажите имя и номер телефона КЛИЕНТА.");
				return;
			}

			if (!isValidCustomerPhone(customerPhone)) {
				setHint("Введите корректный номер телефона КЛИЕНТА (минимум 10 цифр).");
				return;
			}

			socket.emit("customer:clickSlot", {
				slotId,
				customerName,
				customerPhone,
			});
			setHint("Запрос отправлен мастеру.");
			return;
		}

		socket.emit("customer:clickSlot", { slotId });
		setHint("Запрос отменен, слот снова свободен.");
		return;
	}

	socket.emit("executor:clickSlot", { slotId });
	setHint("Статус слота изменен мастером.");
}

function renderCalendar() {
	const slotIds = Object.keys(appState.slots).sort();

	if (slotIds.length === 0) {
		calendarWrapper.innerHTML = "<p>Нет доступных слотов.</p>";
		return;
	}

	const days = Array.from(new Set(slotIds.map((id) => id.split("T")[0]))).sort();
	const times = Array.from(new Set(slotIds.map((id) => id.split("T")[1]))).sort();

	const thead = `
		<thead>
			<tr>
				<th>Время</th>
				${days.map((day) => `<th>${toDisplayDate(day)}</th>`).join("")}
			</tr>
		</thead>
	`;

	const rows = times
		.map((time) => {
			const cells = days
				.map((day) => {
					const slotId = `${day}T${time}`;
					const slot = appState.slots[slotId];
					if (!slot) return "<td></td>";

					const normalizedStatus = normalizeStatus(slot.status);
					const clickable = canClickSlot(normalizedStatus);
					const showCustomerDetails =
						role === "executor" &&
						(normalizedStatus === "requested" || normalizedStatus === "confirmed") &&
						(slot.customerName || slot.customerPhone);

					const customerDetailsHtml = showCustomerDetails
						? `<span class="slot-meta">${escapeHtml(slot.customerName || "Без имени")} | ${escapeHtml(slot.customerPhone || "Без телефона")}</span>`
						: "";

					const historyItems = slot.history || [];
					const historyHtml = historyItems.length > 0
						? `<ul class="slot-history">${historyItems.map((e) => `<li>${historyEntryText(e)}</li>`).join("")}</ul>`
						: "";

					const commentHtml = role === "executor"
						? `<form class="slot-comment-form" data-comment-slot="${slotId}">
							<input class="slot-comment-input" type="text" maxlength="300" placeholder="Комментарий мастера" value="${escapeHtml(slot.comment || "")}" />
							<button type="submit" class="slot-comment-btn" title="Сохранить">✓</button>
						</form>`
						: (slot.comment ? `<span class="slot-comment-readonly">${escapeHtml(slot.comment)}</span>` : "");

					const confirmBtnHtml = role === "executor" && clickable
						? `<button class="slot-confirm-btn" data-confirm-slot="${slotId}" title="Подтвердить">Подтвердить</button>`
						: "";

					return `
						<td>
							<div class="slot-cell">
								<div class="slot-row">
									<button
										class="slot ${normalizedStatus} ${clickable ? "clickable" : ""}"
										data-slot-id="${slotId}"
										${clickable ? "" : "disabled"}
										title="${getStatusLabel(normalizedStatus)}"
									>
										<span class="slot-dot ${normalizedStatus}"></span>
										<span class="slot-label">${getStatusLabel(normalizedStatus)}</span>
										${customerDetailsHtml}
									</button>
									${confirmBtnHtml}
								</div>
								${commentHtml}
								${historyHtml}
							</div>
						</td>
					`;
				})
				.join("");

			return `<tr><td class="time-label">${time}</td>${cells}</tr>`;
		})
		.join("");

	calendarWrapper.innerHTML = `<table class="calendar">${thead}<tbody>${rows}</tbody></table>`;

	calendarWrapper.querySelectorAll("[data-slot-id]").forEach((el) => {
		el.addEventListener("click", () => {
			const slotId = el.getAttribute("data-slot-id");
			const slot = appState.slots[slotId];
			handleSlotClick(slotId, slot.status);
		});
	});

	calendarWrapper.querySelectorAll(".slot-comment-form").forEach((form) => {
		form.addEventListener("submit", (e) => {
			e.preventDefault();
			const slotId = form.getAttribute("data-comment-slot");
			const input = form.querySelector(".slot-comment-input");
			socket.emit("executor:setComment", { slotId, comment: input.value });
			setHint("Комментарий сохранён.");
		});
	});

	calendarWrapper.querySelectorAll(".slot-confirm-btn").forEach((btn) => {
		btn.addEventListener("click", () => {
			const slotId = btn.getAttribute("data-confirm-slot");
			socket.emit("executor:confirmSlot", { slotId });
			setHint("Статус зафиксирован в истории.");
		});
	});
}

function renderRoleState() {
	const executorMode = role === "executor";
	customerData.classList.toggle("hidden", executorMode);
	settingsSection.classList.toggle("hidden", !executorMode);

	settingsForm.querySelectorAll("input:not([name='workDay']), select, button").forEach((el) => {
		el.disabled = !executorMode;
	});

	settingsForm.querySelectorAll("input[name='workDay']").forEach((el) => {
		el.disabled = false;
	});

	if (role === "customer") {
		setHint("КЛИЕНТ: белый слот создает запрос, повторный клик по желтому отменяет запрос.");
	} else {
		setHint("МАСТЕР: каждый клик по слоту переключает статус по циклу.");
	}
}

function fillSettingsForm() {
	startHourInput.value = appState.settings.startHour;
	endHourInput.value = appState.settings.endHour;
	slotMinutesSelect.value = String(appState.settings.slotMinutes);

	const workDays = Array.isArray(appState.settings.workDays)
		? appState.settings.workDays
		: Array.isArray(appState.settings.offDays)
			? ALL_WEEK_DAYS.filter((day) => !appState.settings.offDays.includes(day))
			: [1, 2, 3, 4, 5];

	settingsForm.querySelectorAll('input[name="workDay"]').forEach((el) => {
		el.checked = workDays.includes(Number(el.value));
	});
}

roleSelect.addEventListener("change", (event) => {
	role = event.target.value;
	renderRoleState();
	renderCalendar();
});

customerPhoneInput.addEventListener("focus", () => {
	if (!customerPhoneInput.value.trim()) {
		customerPhoneInput.value = PHONE_PREFIX;
	}
});

customerPhoneInput.addEventListener("input", () => {
	customerPhoneInput.value = normalizeCustomerPhoneInput(customerPhoneInput.value);
});

settingsForm.addEventListener("submit", (event) => {
	event.preventDefault();

	const workDays = Array.from(settingsForm.querySelectorAll('input[name="workDay"]:checked')).map((el) =>
		Number(el.value)
	);
	const offDays = ALL_WEEK_DAYS.filter((day) => !workDays.includes(day));

	socket.emit("executor:updateSettings", {
		startHour: Number(startHourInput.value),
		endHour: Number(endHourInput.value),
		slotMinutes: Number(slotMinutesSelect.value),
		workDays,
		offDays,
	});

	setHint("Рабочие часы обновлены. Календарь перестроен.");
});

socket.on("state", (nextState) => {
	appState = nextState;
	fillSettingsForm();

	renderCalendar();
});

socket.on("error:message", (message) => {
	setHint(message);
});

if (!customerPhoneInput.value.trim()) {
	customerPhoneInput.value = PHONE_PREFIX;
}

renderRoleState();
