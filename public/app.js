const socket = io();
const AppDates = window.AppDates || {};
const AppStorage = window.AppStorage || {};

if (!window.AppDates) {
	throw new Error("Date helpers failed to load.");
}
if (!window.AppStorage) {
	throw new Error("Storage helpers failed to load.");
}

const {
	pad,
	dateKey,
	parseDateKey,
	startOfDay,
	addDays,
	startOfWeek,
	startOfMonth,
	monthLabelText,
	weekdayToWeekOffset,
	dateForWeekDay,
	toDisplayDate,
	weekLabelText,
	dayLabelText,
	formatDayForDisplay,
} = AppDates;

const {
	readStoredProfile: appStorageReadStoredProfile,
	saveViewState: appStorageSaveViewState,
	restoreViewState: appStorageRestoreViewState,
	saveCustomerProfileToStorage: appStorageSaveCustomerProfileToStorage,
	loadCustomerProfileFromStorage: appStorageLoadCustomerProfileFromStorage,
	saveMasterProfileToStorage: appStorageSaveMasterProfileToStorage,
	loadMasterProfileFromStorage: appStorageLoadMasterProfileFromStorage,
	syncAppVersion: appStorageSyncAppVersion,
} = AppStorage;

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
const masterNameInput = document.getElementById("master-name");
const masterPhoneInput = document.getElementById("master-phone");
const masterAddressInput = document.getElementById("master-address");
const masterTopbar = document.querySelector(".master-page .master-topbar");
const settingsSection = document.getElementById("settings-section");
const masterSettingsBtn = document.getElementById("master-settings-btn");
const settingsPanel = document.querySelector(".master-page .panel-side");
const settingsSubmitBtn = settingsForm ? settingsForm.querySelector('button[type="submit"]') : null;
const customerMasterNameEl = document.getElementById("customer-master-name");
const customerMasterPhoneEl = document.getElementById("customer-master-phone");
const customerMasterAddressEl = document.getElementById("customer-master-address");

const WEEKDAY_LABELS = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
const WEEKDAY_LABELS_FULL = ["ВОСКРЕСЕНЬЕ", "ПОНЕДЕЛЬНИК", "ВТОРНИК", "СРЕДА", "ЧЕТВЕРГ", "ПЯТНИЦА", "СУББОТА"];
const WEEKDAY_LABELS_LOWER = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];
const MONTH_NAMES_GENITIVE_LOWER = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const PHONE_PREFIX = "+7";
const CUSTOMER_PROFILE_STORAGE_KEY = "customerProfile";
const MASTER_PROFILE_STORAGE_KEY = "masterProfile";
const APP_VERSION_STORAGE_KEY = "appVersion";
const CUSTOMER_VISIBLE_AHEAD_DAYS = 10;
const CUSTOMER_STATE_SYNC_INTERVAL_MS = 15000;

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
let masterTopbarBindingsAdded = false;
let calendarTopbarHeader = null;
let hasAutoScrolledToCurrentSlot = false;
let hasReceivedInitialState = false;
let highlightedRequestedSlotId = "";
let requestedSlotHighlightUntil = 0;
let settingsSavedSnapshot = "";
let customerStateSyncIntervalId = 0;
let lastStateReceivedAt = 0;

function saveViewState() {
	appStorageSaveViewState({
		currentView,
		currentDay,
		currentWeekStart,
		currentMonthStart,
		dateKey,
	});
}

function restoreViewState() {
	const restored = appStorageRestoreViewState({
		role,
		parseDateKey,
		startOfDay,
		startOfWeek,
		currentNow,
	});
	if (!restored) return;
	if (restored.currentView) currentView = restored.currentView;
	if (restored.currentDay) currentDay = restored.currentDay;
	if (restored.currentWeekStart) currentWeekStart = restored.currentWeekStart;
	if (restored.currentMonthStart) currentMonthStart = restored.currentMonthStart;
	console.log("Restored view state:", restored.rawState || {});
}

function normalizePhoneOrEmpty(value) {
	const raw = String(value || "").trim();
	if (!raw) return "";
	return normalizeCustomerPhoneInput(raw);
}

function readStoredProfile(storageKey) {
	return appStorageReadStoredProfile(storageKey);
}

function saveCustomerProfileToStorage() {
	appStorageSaveCustomerProfileToStorage({
		customerNameInput,
		customerPhoneInput,
		normalizeCustomerNameInput,
		normalizePhoneOrEmpty,
		storageKey: CUSTOMER_PROFILE_STORAGE_KEY,
	});
}

function loadCustomerProfileFromStorage() {
	appStorageLoadCustomerProfileFromStorage({
		customerNameInput,
		customerPhoneInput,
		normalizeCustomerNameInput,
		normalizePhoneOrEmpty,
		storageKey: CUSTOMER_PROFILE_STORAGE_KEY,
	});
}

function saveMasterProfileToStorage() {
	appStorageSaveMasterProfileToStorage({
		masterNameInput,
		masterPhoneInput,
		masterAddressInput,
		normalizePhoneOrEmpty,
		storageKey: MASTER_PROFILE_STORAGE_KEY,
	});
}

function loadMasterProfileFromStorage() {
	appStorageLoadMasterProfileFromStorage({
		masterNameInput,
		masterPhoneInput,
		masterAddressInput,
		normalizePhoneOrEmpty,
		storageKey: MASTER_PROFILE_STORAGE_KEY,
	});
}

function ensureCalendarTopbarHeader() {
	if (calendarTopbarHeader) return calendarTopbarHeader;
	if (!masterTopbar || role !== "executor") return null;
	calendarTopbarHeader = document.createElement("div");
	calendarTopbarHeader.id = "calendar-topbar-header";
	calendarTopbarHeader.className = "calendar-topbar-header hidden";
	calendarTopbarHeader.setAttribute("aria-hidden", "true");
	masterTopbar.appendChild(calendarTopbarHeader);
	return calendarTopbarHeader;
}

function updateMasterLayoutOffset() {
	if (!masterTopbar) return;
	const top = Number.parseFloat(window.getComputedStyle(masterTopbar).top) || 0;
	const extraGap = 14;
	const offset = Math.ceil(masterTopbar.getBoundingClientRect().height + top + extraGap);
	document.documentElement.style.setProperty("--master-topbar-offset", `${offset}px`);
}

function getSettingsSnapshot() {
	if (!settingsForm) return "";
	const masterName = String(masterNameInput ? masterNameInput.value : "").replace(/\s+/g, " ").trim();
	const masterPhone = normalizePhoneOrEmpty(masterPhoneInput ? masterPhoneInput.value : "");
	const masterAddress = String(masterAddressInput ? masterAddressInput.value : "").replace(/\s+/g, " ").trim();
	const startHour = Number(workStartHourInput ? workStartHourInput.value : appState.settings?.startHour ?? 9);
	const endHour = Number(workEndHourInput ? workEndHourInput.value : appState.settings?.endHour ?? 18);
	const workDays = Array.from(settingsForm.querySelectorAll('input[name="workDay"]:checked'))
		.map((el) => Number(el.value))
		.sort((a, b) => a - b);
	return JSON.stringify({ masterName, masterPhone, masterAddress, startHour, endHour, workDays });
}

function setSettingsSubmitVisible(isVisible) {
	if (!settingsSubmitBtn) return;
	settingsSubmitBtn.hidden = !isVisible;
}

function markSettingsSnapshotSaved() {
	settingsSavedSnapshot = getSettingsSnapshot();
	setSettingsSubmitVisible(false);
}

function refreshSettingsSubmitVisibility() {
	if (!settingsForm || role !== "executor") {
		setSettingsSubmitVisible(false);
		return;
	}
	if (!settingsSavedSnapshot) settingsSavedSnapshot = getSettingsSnapshot();
	setSettingsSubmitVisible(getSettingsSnapshot() !== settingsSavedSnapshot);
}

function updateSettingsCompactMode() {
	if (!settingsPanel) return;
	const viewportWidth = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
	settingsPanel.classList.toggle("settings-compact", viewportWidth <= 980);
	settingsPanel.classList.toggle("settings-compact-xs", viewportWidth <= 560);
}

function clearMasterTopbarHeader() {
	if (!ensureCalendarTopbarHeader()) {
		updateMasterLayoutOffset();
		return;
	}
	calendarTopbarHeader.innerHTML = "";
	calendarTopbarHeader.classList.add("hidden");
	updateMasterLayoutOffset();
}

function syncMasterTopbarHeader() {
	if (!calendarTopbarHeader || calendarTopbarHeader.classList.contains("hidden")) return;
	const bodyTable = calendarWrapper ? calendarWrapper.querySelector("table.calendar") : null;
	const topTable = calendarTopbarHeader.querySelector("table.calendar-topbar-table");
	if (!bodyTable || !topTable) return;
	let bodyHeaderCells = Array.from(bodyTable.querySelectorAll("thead th"));
	if (bodyHeaderCells.length === 0) {
		const firstBodyRow = bodyTable.querySelector("tbody tr");
		if (firstBodyRow) bodyHeaderCells = Array.from(firstBodyRow.querySelectorAll("td"));
	}
	if (bodyHeaderCells.length === 0) return;

	const wrapperRect = calendarWrapper.getBoundingClientRect();
	const topbarRect = masterTopbar ? masterTopbar.getBoundingClientRect() : null;
	if (topbarRect) {
		const topbarStyles = window.getComputedStyle(masterTopbar);
		const topbarContentLeft = topbarRect.left + (Number.parseFloat(topbarStyles.paddingLeft) || 0);
		calendarTopbarHeader.style.marginLeft = `${wrapperRect.left - topbarContentLeft}px`;
		calendarTopbarHeader.style.width = `${wrapperRect.width}px`;
	}
	const headerCells = Array.from(topTable.querySelectorAll("th"));
	if (bodyHeaderCells.length === headerCells.length) {
		headerCells.forEach((cell, i) => {
			cell.style.width = `${bodyHeaderCells[i].getBoundingClientRect().width}px`;
		});
	}
	topTable.style.width = `${bodyTable.getBoundingClientRect().width}px`;
	const baseShift = -calendarWrapper.scrollLeft;
	topTable.style.transform = `translateX(${baseShift}px)`;

	if (headerCells.length > 0 && bodyHeaderCells.length > 0) {
		const anchorIndex = Math.min(1, headerCells.length - 1, bodyHeaderCells.length - 1);
		const bodyAnchorLeft = bodyHeaderCells[anchorIndex].getBoundingClientRect().left;
		const topAnchorLeft = headerCells[anchorIndex].getBoundingClientRect().left;
		const correctionShift = bodyAnchorLeft - topAnchorLeft;
		const weekNudge = currentView === "week" ? -1 : 0;
		topTable.style.transform = `translateX(${baseShift + correctionShift + weekNudge}px)`;
	}
	updateMasterLayoutOffset();
}

function ensureMasterTopbarBindings() {
	if (!calendarWrapper || masterTopbarBindingsAdded) return;
	calendarWrapper.addEventListener("scroll", () => {
		syncMasterTopbarHeader();
	}, { passive: true });
	window.addEventListener("resize", () => {
		syncMasterTopbarHeader();
		updateMasterLayoutOffset();
		updateSettingsCompactMode();
	});
	masterTopbarBindingsAdded = true;
}

function renderMasterTopbarHeader(theadHtml, colgroupHtml = "") {
	if (!ensureCalendarTopbarHeader()) return;
	calendarTopbarHeader.innerHTML = `<table class="calendar calendar-topbar-table">${colgroupHtml}${theadHtml}</table>`;
	calendarTopbarHeader.classList.remove("hidden");
	ensureMasterTopbarBindings();
	// Wait one frame so layout is finalized before reading widths.
	requestAnimationFrame(() => {
		syncMasterTopbarHeader();
	});
}

function findCustomerRequestedSlots() {
	if (role !== "customer") return [];
	if (!customerIdentityReady()) return [];
	const customerName = normalizeCustomerNameInput(customerNameInput ? customerNameInput.value : "");
	const customerPhone = normalizeCustomerPhoneInput(customerPhoneInput ? customerPhoneInput.value : "");
	if (!customerName || !customerPhone) return [];
	return Object.values(appState.slots || {})
		.filter((slot) => normalizeStatus(slot?.status) === "requested")
		.filter((slot) => {
			const identity = getSlotCustomerIdentity(slot);
			return normalizeCustomerNameInput(identity.name) === customerName
				&& normalizeCustomerPhoneInput(identity.phone) === customerPhone;
		})
		.sort((a, b) => {
			const aDt = slotDateTime(a);
			const bDt = slotDateTime(b);
			return (aDt ? aDt.getTime() : 0) - (bDt ? bDt.getTime() : 0);
		});
}

function findCustomerRequestedSlot() {
	const requestedSlots = findCustomerRequestedSlots();
	return requestedSlots.length > 0 ? requestedSlots[0] : null;
}

function getCustomerAvailableDaysWithSlots() {
	if (role !== "customer") return [];
	const rangeStart = getCustomerRangeStart();
	const rangeEnd = getCustomerRangeEnd();
	const daysWithFree = new Map();
	Object.values(appState.slots || {}).forEach((slot) => {
		if (normalizeStatus(slot?.status) !== "free" || isPastSlot(slot)) return;
		if (!slot.datePart) return;
		const d = parseDateKey(slot.datePart);
		if (!d) return;
		const dayStart = startOfDay(d);
		if (!isWithinCustomerVisibleWindow(dayStart)) return;
		const key = dateKey(dayStart);
		if (!daysWithFree.has(key)) daysWithFree.set(key, dayStart);
	});
	return Array.from(daysWithFree.values()).sort((a, b) => a.getTime() - b.getTime()).slice(0, 3);
}

function formatCustomerSlotSummary(slot) {
	const slotDate = parseDateKey(slot?.datePart || "");
	const slotTime = String(slot?.timePart || "").trim() || "--:--";
	if (!slotDate) return slotTime;
	return `${slotTime}, ${formatDayForDisplay(slotDate)}`;
}

function setHint(text) {
	if (!hint) return;
	if (role !== "customer") {
		hint.textContent = text;
		return;
	}
	const confirmedSlots = findCustomerConfirmedSlots();
	const requestedSlots = findCustomerRequestedSlots();
	if (confirmedSlots.length > 0 || requestedSlots.length > 0) {
		const parts = [];
		if (confirmedSlots.length === 1) {
			parts.push(confirmedSlotHintText(confirmedSlots[0]));
		} else if (confirmedSlots.length > 1) {
			parts.push(`Ваши записи:\n${confirmedSlots.map((slot) => `• ${formatCustomerSlotSummary(slot)}`).join("\n")}`);
		}
		if (requestedSlots.length === 1) {
			parts.push(`Запрос ожидает подтверждения:\n• ${formatCustomerSlotSummary(requestedSlots[0])}.`);
		} else if (requestedSlots.length > 1) {
			parts.push(`Запросы ожидают подтверждения:\n${requestedSlots.map((slot) => `• ${formatCustomerSlotSummary(slot)}`).join("\n")}`);
		}
		hint.textContent = parts.join("\n");
		return;
	}
	const availableDays = getCustomerAvailableDaysWithSlots();
	if (availableDays.length > 0) {
		const daysStr = availableDays.map(formatDayForDisplay).join(", ");
		hint.textContent = `Есть свободное время для записи в ${daysStr}.`;
		return;
	}
	hint.textContent = text;
}

function updateCustomerMasterInfo() {
	if (role !== "customer") return;
	if (!customerMasterNameEl && !customerMasterPhoneEl && !customerMasterAddressEl) return;
	const serverMasterProfile = {
		name: String(appState?.settings?.masterName || "").trim(),
		phone: normalizePhoneOrEmpty(appState?.settings?.masterPhone || ""),
		address: String(appState?.settings?.masterAddress || "").trim(),
	};
	if (serverMasterProfile.name || serverMasterProfile.phone || serverMasterProfile.address) {
		try {
			localStorage.setItem(MASTER_PROFILE_STORAGE_KEY, JSON.stringify(serverMasterProfile));
		} catch (e) {
			console.warn("Failed to persist latest master profile:", e);
		}
	}
	const localMasterProfile = readStoredProfile(MASTER_PROFILE_STORAGE_KEY);
	const masterName = serverMasterProfile.name || String(localMasterProfile.name || "").trim() || "...";
	const masterPhone = serverMasterProfile.phone || String(localMasterProfile.phone || "").trim() || "...";
	const masterAddress = serverMasterProfile.address || String(localMasterProfile.address || "").trim() || "...";
	if (customerMasterNameEl) customerMasterNameEl.textContent = masterName;
	if (customerMasterPhoneEl) customerMasterPhoneEl.textContent = masterPhone;
	if (customerMasterAddressEl) customerMasterAddressEl.textContent = masterAddress;
}

function requestLatestState(reason = "manual") {
	if (!socket || typeof socket.emit !== "function") return;
	if (!socket.connected) {
		socket.connect();
		return;
	}
	socket.emit("client:requestState", { reason: String(reason || "manual").slice(0, 40) });
}

function syncAppVersion() {
	const runtimeVersion = String((typeof window !== "undefined" && window.APP_VERSION) || "").trim();
	appStorageSyncAppVersion({ runtimeVersion, storageKey: APP_VERSION_STORAGE_KEY });
}

function ensureCustomerLiveSync() {
	if (role !== "customer" || customerStateSyncIntervalId) return;
	customerStateSyncIntervalId = window.setInterval(() => {
		if (document.visibilityState === "hidden") return;
		if (!lastStateReceivedAt || (Date.now() - lastStateReceivedAt) >= CUSTOMER_STATE_SYNC_INTERVAL_MS) {
			requestLatestState("heartbeat");
		}
	}, CUSTOMER_STATE_SYNC_INTERVAL_MS);
}

function scrollToMasterSettings() {
	if (!settingsSection) return;
	const topbarHeight = masterTopbar ? masterTopbar.getBoundingClientRect().height : 0;
	const targetTop = window.scrollY + settingsSection.getBoundingClientRect().top - topbarHeight - 12;
	window.scrollTo({
		top: Math.max(0, targetTop),
		behavior: "smooth",
	});
}

function currentNow() {
	return appState.meta?.nowIso ? new Date(appState.meta.nowIso) : new Date();
}

function getCustomerRangeStart() {
	return parseDateKey(appState.meta?.rangeStart) || startOfDay(currentNow());
}

function getCustomerRangeEnd() {
	const metaRangeEnd = parseDateKey(appState.meta?.rangeEnd);
	if (metaRangeEnd) return startOfDay(metaRangeEnd);
	return addDays(startOfDay(currentNow()), Math.max(0, CUSTOMER_VISIBLE_AHEAD_DAYS - 1));
}

function isWithinCustomerVisibleWindow(date) {
	const day = startOfDay(date);
	return day >= getCustomerRangeStart() && day <= getCustomerRangeEnd();
}

function currentSlotTimeLabel() {
	const now = currentNow();
	const step = Math.max(1, Number(appState.settings?.slotMinutes ?? 15));
	const startHour = Number(appState.settings?.startHour ?? 9);
	const endHour = Number(appState.settings?.endHour ?? 18);
	const startMinutes = Math.max(0, startHour * 60);
	const endMinutes = Math.max(startMinutes + step, endHour * 60);
	const lastSlotStart = endMinutes - step;
	const nowMinutes = now.getHours() * 60 + now.getMinutes();
	const boundedNow = Math.min(Math.max(nowMinutes, startMinutes), lastSlotStart);
	const offset = boundedNow - startMinutes;
	const roundedOffset = Math.floor(offset / step) * step;
	const slotMinutes = startMinutes + roundedOffset;
	return `${pad(Math.floor(slotMinutes / 60))}:${pad(slotMinutes % 60)}`;
}

function autoScrollToCurrentSlotRow() {
	if (!calendarWrapper || currentView === "month" || hasAutoScrolledToCurrentSlot) {
		console.log("autoScroll skip:", { noWrapper: !calendarWrapper, isMonth: currentView === "month", alreadyScrolled: hasAutoScrolledToCurrentSlot });
		return;
	}
	const todayKey = dateKey(startOfDay(currentNow()));
	const visibleToday = currentView === "day"
		? dateKey(startOfDay(currentDay)) === todayKey
		: dateKey(currentWeekStart) <= todayKey && dateKey(addDays(currentWeekStart, 6)) >= todayKey;
	if (!visibleToday) {
		console.log("autoScroll: today not visible in range", { todayKey, currentWeekStart: dateKey(currentWeekStart), currentDay: dateKey(currentDay), view: currentView });
		hasAutoScrolledToCurrentSlot = true;
		return;
	}

	const table = calendarWrapper.querySelector("table.calendar");
	if (!table) {
		console.log("autoScroll: no table found");
		return;
	}
	const targetTime = currentSlotTimeLabel();
	const rows = Array.from(table.querySelectorAll("tbody tr"));
	const targetRow = rows.find((row) => {
		const timeCell = row.querySelector("td.time-label");
		return timeCell && timeCell.textContent && timeCell.textContent.trim() === targetTime;
	});
	if (!targetRow) {
		console.log("autoScroll: target row not found for time", { targetTime });
		return;
	}

	try {
		const topbarElem = document.querySelector(".master-page .master-topbar");
		const topbarHeight = topbarElem ? topbarElem.getBoundingClientRect().height : 0;
		const theadElem = table.querySelector("thead");
		const theadHeight = theadElem ? theadElem.getBoundingClientRect().height : 0;
		const rowRect = targetRow.getBoundingClientRect();
		const scrollTop = Math.max(0, Math.round(window.scrollY + rowRect.top - topbarHeight - theadHeight - 8));
		console.log("autoScroll executing", { targetTime, topbarHeight, theadHeight, rowTop: rowRect.top, scrollingTo: scrollTop });
		window.scrollTo({ top: scrollTop, behavior: "auto" });
		hasAutoScrolledToCurrentSlot = true;
	} catch (e) {
		console.warn("Auto-scroll to current slot failed:", e);
	}
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

function shouldHighlightNewRequestSlot(slotId) {
	return role === "executor"
		&& String(slotId || "") === highlightedRequestedSlotId
		&& Date.now() < requestedSlotHighlightUntil;
}

function playNewRequestSound() {
	if (role !== "executor") return;
	try {
		const AudioCtx = window.AudioContext || window.webkitAudioContext;
		if (!AudioCtx) return;
		const ctx = new AudioCtx();
		const oscillator = ctx.createOscillator();
		const gainNode = ctx.createGain();
		oscillator.type = "sine";
		oscillator.frequency.setValueAtTime(880, ctx.currentTime);
		gainNode.gain.setValueAtTime(0.0001, ctx.currentTime);
		gainNode.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.015);
		gainNode.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.3);
		oscillator.connect(gainNode);
		gainNode.connect(ctx.destination);
		oscillator.start();
		oscillator.stop(ctx.currentTime + 0.32);
		oscillator.onended = () => {
			ctx.close().catch(() => {});
		};
	} catch (e) {
		console.warn("Failed to play request sound:", e);
	}
}

function markRequestedSlotAttention(slotId) {
	if (role !== "executor" || !slotId) return;
	highlightedRequestedSlotId = String(slotId);
	requestedSlotHighlightUntil = Date.now() + 2800;
	playNewRequestSound();
	setTimeout(() => {
		if (highlightedRequestedSlotId !== String(slotId)) return;
		if (Date.now() < requestedSlotHighlightUntil) return;
		highlightedRequestedSlotId = "";
		requestedSlotHighlightUntil = 0;
		renderView();
	}, 2900);
}

function findNewCustomerRequestedSlotId(prevState, nextState) {
	if (role !== "executor") return "";
	const prevSlots = prevState && prevState.slots ? prevState.slots : {};
	const nextSlots = nextState && nextState.slots ? nextState.slots : {};
	const candidates = Object.values(nextSlots)
		.filter((slot) => normalizeStatus(slot?.status) === "requested")
		.filter((slot) => {
			const prevSlot = prevSlots[slot.id];
			if (normalizeStatus(prevSlot?.status) === "requested") return false;
			const history = Array.isArray(slot.history) ? slot.history : [];
			const lastEntry = history[history.length - 1] || {};
			return String(lastEntry.by || "") === "customer" && normalizeStatus(lastEntry.toStatus || slot.status) === "requested";
		});
	if (candidates.length === 0) return "";
	candidates.sort((a, b) => {
		const aTime = slotDateTime(a);
		const bTime = slotDateTime(b);
		const diff = (aTime ? aTime.getTime() : 0) - (bTime ? bTime.getTime() : 0);
		if (diff !== 0) return diff;
		return String(a.id || "").localeCompare(String(b.id || ""));
	});
	return String(candidates[0].id || "");
}

function scrollToSlotById(slotId) {
	if (!calendarWrapper || !slotId) return;
	const slotButton = calendarWrapper.querySelector(`[data-slot-id="${slotId}"]`);
	if (!slotButton) return;
	const rowElem = slotButton.closest("tr");
	const table = calendarWrapper.querySelector("table.calendar");
	if (!rowElem || !table) return;
	try {
		const topbarElem = document.querySelector(".master-page .master-topbar");
		const topbarHeight = topbarElem ? topbarElem.getBoundingClientRect().height : 0;
		const theadElem = table.querySelector("thead");
		const theadHeight = theadElem ? theadElem.getBoundingClientRect().height : 0;
		const rowRect = rowElem.getBoundingClientRect();
		const scrollTop = Math.max(0, Math.round(window.scrollY + rowRect.top - topbarHeight - theadHeight - 8));
		window.scrollTo({ top: scrollTop, behavior: "smooth" });
	} catch (e) {
		console.warn("Auto-scroll to requested slot failed:", e);
	}
}

function focusNewRequestedSlot(slotId) {
	if (role !== "executor" || !slotId) return;
	const slot = appState?.slots?.[slotId];
	if (!slot) return;
	markRequestedSlotAttention(slotId);
	const slotDate = parseDateKey(slot.datePart);
	if (!slotDate) return;
	const slotDay = startOfDay(slotDate);
	const weekStart = startOfDay(currentWeekStart);
	const weekEnd = startOfDay(addDays(currentWeekStart, 6));
	const inCurrentWeek = slotDay >= weekStart && slotDay <= weekEnd;
	if (currentView !== "week" || !inCurrentWeek) {
		currentDay = slotDay;
		currentWeekStart = startOfWeek(slotDay);
		currentView = "week";
		saveViewState();
		updateViewUI();
		renderWeekControls();
		renderView();
	}
	setTimeout(() => {
		scrollToSlotById(slotId);
	}, 0);
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
	return "занято";
}

function getSlotCustomerIdentity(slot) {
	const directName = String(slot?.customerName || "");
	const directPhone = String(slot?.customerPhone || "");
	if (directName && directPhone) {
		return { name: directName, phone: directPhone };
	}
	const history = Array.isArray(slot?.history) ? slot.history : [];
	for (let i = history.length - 1; i >= 0; i -= 1) {
		const item = history[i] || {};
		const hName = String(item.customerName || "");
		const hPhone = String(item.customerPhone || "");
		if (hName && hPhone) {
			return { name: hName, phone: hPhone };
		}
	}
	return { name: "", phone: "" };
}

function confirmedSlotHintText(slot) {
	const slotDate = parseDateKey(slot?.datePart || "");
	const slotTime = String(slot?.timePart || "").trim() || "--:--";
	if (!slotDate) return `Вы записаны на ${slotTime}.`;
	const weekday = WEEKDAY_LABELS_LOWER[slotDate.getDay()] || "";
	const humanDate = `${slotDate.getDate()} ${MONTH_NAMES_GENITIVE_LOWER[slotDate.getMonth()] || ""}`.trim();
	return `Вы записаны на ${slotTime}, ${weekday}, ${humanDate}.`;
}

function findCustomerConfirmedSlots() {
	if (role !== "customer") return [];
	if (!customerIdentityReady()) return [];
	const customerName = normalizeCustomerNameInput(customerNameInput ? customerNameInput.value : "");
	const customerPhone = normalizeCustomerPhoneInput(customerPhoneInput ? customerPhoneInput.value : "");
	if (!customerName || !customerPhone) return [];
	const confirmedSlots = Object.values(appState.slots || {})
		.filter((slot) => normalizeStatus(slot?.status) === "confirmed")
		.filter((slot) => {
			const identity = getSlotCustomerIdentity(slot);
			return normalizeCustomerNameInput(identity.name) === customerName
				&& normalizeCustomerPhoneInput(identity.phone) === customerPhone;
		})
		.sort((a, b) => {
			const aDt = slotDateTime(a);
			const bDt = slotDateTime(b);
			return (aDt ? aDt.getTime() : 0) - (bDt ? bDt.getTime() : 0);
		});
	if (confirmedSlots.length === 0) return [];
	const nowTs = currentNow().getTime();
	const upcomingSlots = confirmedSlots.filter((slot) => {
		const dt = slotDateTime(slot);
		return dt && dt.getTime() >= nowTs;
	});
	return upcomingSlots.length > 0 ? upcomingSlots : confirmedSlots;
}

function findCustomerConfirmedSlot() {
	const confirmedSlots = findCustomerConfirmedSlots();
	return confirmedSlots[0] || null;
}

function getSlotLabel(slot, status) {
	const normalized = normalizeStatus(status);
	const persistedStatus = normalizeStatus(slot?.status);
	if (role === "customer") {
		if (persistedStatus === "free" && normalized === "requested") return "отправить запрос";
		if (persistedStatus === "requested" && normalized === "requested") return "ждём подтверждения мастера";
		if (normalized === "free") return "свободно";
	}
	if (normalized === "requested" && role === "executor") {
		const identity = getSlotCustomerIdentity(slot);
		if (identity.name && identity.phone) {
			return `запрос от "${identity.name}" ${identity.phone}`;
		}
	}
	if (normalized === "confirmed") {
		const slotTime = String(slot?.timePart || "");
		if (slotTime && role === "customer") return `Ждём вас в ${slotTime}`;
		if (slotTime && role === "executor") return `запись на ${slotTime}`;
	}
	return getStatusLabel(status);
}

function canClickSlot(slot) {
	if (role === "executor" && currentView === "week") return true;
	const normalized = normalizeStatus(slot.status);
	if (isPastSlot(slot)) return false;
	if (role === "customer") {
		return normalized === "free" || normalized === "requested";
	}
	return ["free", "requested", "confirmed", "rejected"].includes(normalized);
}

function nextExecutorStatus(currentStatus) {
	const normalized = normalizeStatus(currentStatus);
	if (normalized === "requested") return "confirmed";
	if (normalized === "confirmed") return "rejected";
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
	const localDigits = digitsOnly.startsWith("7") || digitsOnly.startsWith("8")
		? digitsOnly.slice(1)
		: digitsOnly;
	return `${PHONE_PREFIX}${localDigits.slice(0, 10)}`;
}

function normalizeCustomerNameInput(value) {
	return String(value || "").replace(/\s+/g, " ").trim();
}

function isValidCustomerName(value) {
	const name = normalizeCustomerNameInput(value);
	if (name.length < 2 || name.length > 60) return false;
	if (/\d/.test(name)) return false;
	if (!/^[A-Za-zА-Яа-яЁё\s'\-]+$/.test(name)) return false;
	return /[A-Za-zА-Яа-яЁё]{2,}/.test(name);
}

function isValidRussianMobile(value) {
	const phone = String(value || "").trim();
	if (!/^\+79\d{9}$/.test(phone)) return false;
	return !phone.includes("12345");
}

function isCustomerFreeSlot(slot) {
	return role === "customer"
		&& normalizeStatus(slot?.status) === "free"
		&& !isPastSlot(slot);
}

function getCustomerAvailableDayKeys() {
	if (role !== "customer") return [];
	const dayKeys = new Set();
	const rangeStart = getCustomerRangeStart();
	const rangeEnd = getCustomerRangeEnd();
	Object.values(appState.slots || {}).forEach((slot) => {
		if (!slot?.datePart) return;
		const slotDate = parseDateKey(slot.datePart);
		const slotDay = slotDate ? startOfDay(slotDate) : null;
		if (!slotDay || !isWithinCustomerVisibleWindow(slotDay)) return;
		const status = normalizeStatus(slot?.status);
		if (!isCustomerFreeSlot(slot) && status !== "requested" && status !== "confirmed") return;
		dayKeys.add(String(slot.datePart));
	});
	return Array.from(dayKeys).sort();
}

function findNextCustomerAvailableDay(targetDate) {
	const targetKey = dateKey(startOfDay(targetDate));
	const nextKey = getCustomerAvailableDayKeys().find((dayKey) => dayKey >= targetKey);
	return nextKey ? parseDateKey(nextKey) : null;
}

function findPreviousCustomerAvailableDay(targetDate) {
	const targetKey = dateKey(startOfDay(targetDate));
	const dayKeys = getCustomerAvailableDayKeys();
	for (let i = dayKeys.length - 1; i >= 0; i -= 1) {
		if (dayKeys[i] <= targetKey) return parseDateKey(dayKeys[i]);
	}
	return null;
}

function alignCustomerViewToAvailableSlots(direction = 1) {
	if (role !== "customer") return;
	const dayKeys = getCustomerAvailableDayKeys();
	if (dayKeys.length === 0) return;
	const fallbackDay = direction < 0
		? (findPreviousCustomerAvailableDay(currentDay) || findNextCustomerAvailableDay(currentDay))
		: (findNextCustomerAvailableDay(currentDay) || findPreviousCustomerAvailableDay(currentDay));
	if (currentView === "day") {
		const currentKey = dateKey(startOfDay(currentDay));
		if (!dayKeys.includes(currentKey)) {
			const matchedDay = direction < 0
				? (findPreviousCustomerAvailableDay(currentDay) || fallbackDay)
				: (findNextCustomerAvailableDay(currentDay) || fallbackDay);
			if (matchedDay) currentDay = startOfDay(matchedDay);
		}
		currentWeekStart = startOfWeek(currentDay);
		return;
	}
	if (currentView === "week") {
		const weekStartKey = dateKey(startOfDay(currentWeekStart));
		const weekEndKey = dateKey(addDays(currentWeekStart, 6));
		const hasAvailableDayInWeek = dayKeys.some((dayKey) => dayKey >= weekStartKey && dayKey <= weekEndKey);
		if (!hasAvailableDayInWeek) {
			const matchedDay = direction < 0
				? (findPreviousCustomerAvailableDay(currentWeekStart) || fallbackDay)
				: (findNextCustomerAvailableDay(currentWeekStart) || fallbackDay);
			if (matchedDay) {
				currentDay = startOfDay(matchedDay);
				currentWeekStart = startOfWeek(matchedDay);
			}
		}
	}
}

function customerIdentityReady() {
	if (role !== "customer") return true;
	const nameValue = customerNameInput ? customerNameInput.value : "";
	const phoneValue = customerPhoneInput ? customerPhoneInput.value : "";
	return isValidCustomerName(nameValue) && isValidRussianMobile(phoneValue);
}

function renderCustomerIdentityGate() {
	if (!calendarWrapper) return;
	calendarWrapper.innerHTML = "<p>Чтобы увидеть расписание, укажите корректные имя и номер телефона.</p>";
	setHint("Введите имя (только буквы) и телефон в формате +79XXXXXXXXX.");
}

function syncCustomerIdentityGate() {
	if (role !== "customer") return;
	if (!customerIdentityReady()) {
		renderCustomerIdentityGate();
		if (weekPrevBtn) weekPrevBtn.disabled = true;
		if (weekNextBtn) weekNextBtn.disabled = true;
		if (monthPrevBtn) monthPrevBtn.disabled = true;
		if (monthNextBtn) monthNextBtn.disabled = true;
		return;
	}
	alignCustomerViewToAvailableSlots(1);
	if (weekPrevBtn) weekPrevBtn.disabled = false;
	if (weekNextBtn) weekNextBtn.disabled = false;
	if (monthPrevBtn) monthPrevBtn.disabled = false;
	if (monthNextBtn) monthNextBtn.disabled = false;
	renderWeekControls();
	renderView();
	setHint("Клиент: доступны будущие даты для записи.");
}

function handleSlotClick(slot) {
	if (!canClickSlot(slot)) return;

	if (role === "executor" && currentView === "week") {
		const slotDate = parseDateKey(slot.datePart);
		if (!slotDate) return;
		currentDay = startOfDay(slotDate);
		currentWeekStart = startOfWeek(currentDay);
		currentView = "day";
		saveViewState();
		updateViewUI();
		renderWeekControls();
		renderView();
		setTimeout(() => {
			scrollToSlotById(slot.id);
		}, 0);
		return;
	}

	if (role === "customer") {
		const persistedStatus = normalizeStatus(slot.status);
		const currentDraft = customerDraftStatuses[slot.id] || persistedStatus;
		if (persistedStatus === "free" && currentDraft === "free") {
			customerDraftStatuses[slot.id] = "requested";
			renderCalendar();
			setHint("Нажмите «отправить запрос», чтобы отправить резерв мастеру.");
			return;
		}
		if (persistedStatus === "free" && currentDraft === "requested") {
			if (!customerIdentityReady()) {
				renderCustomerIdentityGate();
				return;
			}
			socket.emit("customer:confirmSlot", {
				slotId: slot.id,
				selectedStatus: "requested",
				customerName: normalizeCustomerNameInput(customerNameInput ? customerNameInput.value : ""),
				customerPhone: normalizeCustomerPhoneInput(customerPhoneInput ? customerPhoneInput.value : ""),
			});
			setHint("Запрос отправлен.");
			return;
		}
		if (persistedStatus === "requested") {
			setHint("Ждём подтверждения мастера.");
			return;
		}
		return;
	}

	const currentDraft = executorDraftStatuses[slot.id] || normalizeStatus(slot.status);
	executorDraftStatuses[slot.id] = nextExecutorStatus(currentDraft);
	renderCalendar();
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

function historyEntryText(entry, slot) {
	const time = entry?.at ? `${pad(new Date(entry.at).getHours())}:${pad(new Date(entry.at).getMinutes())}` : "";
	const identity = getSlotCustomerIdentity(slot);
	const customerName = String(entry?.customerName || identity.name || "");
	const customerPhone = String(entry?.customerPhone || identity.phone || "");
	const masterName = String(appState?.settings?.masterName || "");
	let customerLabel;
	if (role === "executor" && customerName && customerPhone) {
		customerLabel = `клиент "${customerName}" ${customerPhone}`;
	} else if (role === "customer" && customerName) {
		customerLabel = customerName;
	} else {
		customerLabel = "клиент";
	}
	const executorLabel = (role === "customer" && masterName) ? masterName : "мастер";
	if (entry.kind === "comment") {
		if (entry.by === "executor") return `${time} — ${executorLabel}: ${entry.comment || ""}`;
		return `${time} — ${customerLabel}: ${entry.comment || ""}`;
	}
	if (entry.by === "executor") return `${time} — ${executorLabel}: ${getStatusLabel(entry.toStatus || "")}`;
	return `${time} — ${customerLabel}: ${getStatusLabel(entry.toStatus || "")}`;
}

function getVisibleHistoryEntries(slot) {
	const history = Array.isArray(slot?.history) ? slot.history : [];
	if (role !== "customer") return history;
	return history.filter((entry) => {
		const by = String(entry?.by || "");
		if (by === "customer") return true;
		if (by === "executor") {
			// Hide master's internal comments not tied to a specific customer conversation.
			return Boolean(String(entry?.customerId || ""));
		}
		return false;
	});
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
	if (role === "customer" && !customerIdentityReady()) {
		renderCustomerIdentityGate();
		return;
	}
	const todayStart = startOfDay(currentNow());
	if (role === "customer") alignCustomerViewToAvailableSlots(1);
	let days = currentView === "day"
		? [startOfDay(currentDay)]
		: Array.from({ length: 7 }, (_, i) => addDays(currentWeekStart, i));
	if (role === "customer") {
		const availableDayKeys = new Set(getCustomerAvailableDayKeys());
		if (currentView !== "day") {
			days = days.filter((d) => startOfDay(d) >= todayStart);
		}
		days = days.filter((d) => availableDayKeys.has(dateKey(startOfDay(d))));
	}
	if (days.length === 0) {
		calendarWrapper.innerHTML = "<p>На выбранный период сейчас нет свободных слотов.</p>";
		clearMasterTopbarHeader();
		return;
	}
	const dayKeys = days.map(dateKey);
	const dayKeySet = new Set(dayKeys);
	const weekKey = dateKey(currentWeekStart);
	const weekWorkDays = Array.isArray(appState.weekWorkDays?.[weekKey]) ? appState.weekWorkDays[weekKey] : [];
	const localRangeEnd = role === "customer" ? getCustomerRangeEnd() : null;
	const visibleSlots = Object.values(appState.slots || {}).filter((slot) => {
		if (!dayKeySet.has(slot.datePart)) return false;
		if (role !== "customer") return true;
		const slotDate = parseDateKey(slot.datePart);
		return !!slotDate && isWithinCustomerVisibleWindow(slotDate) && startOfDay(slotDate) <= localRangeEnd;
	});
	if (visibleSlots.length === 0) {
		calendarWrapper.innerHTML = "<p>На выбранный период сейчас нет свободных слотов.</p>";
		clearMasterTopbarHeader();
		return;
	}

	const grouped = {};
	visibleSlots.forEach((slot) => {
		if (!grouped[slot.baseKey]) grouped[slot.baseKey] = [];
		grouped[slot.baseKey].push(slot);
	});

	const times = getTimesFromSettings();
	const timesToRender = role === "customer"
		? times.filter((time) => dayKeys.some((dayKey) => {
			const key = `${dayKey}T${time}`;
			const slotsInCell = (grouped[key] || []).filter((slot) => {
				const st = normalizeStatus(slot?.status);
				return !isPastSlot(slot) || st === "requested" || st === "confirmed";
			});
			return slotsInCell.length > 0;
		}))
		: times;
	const isMasterWeekView = role === "executor" && currentView === "week";
	const isWeekView = currentView === "week";
	const WEEK_TIME_COL_WIDTH = 82;
	const WEEK_NON_WORK_COL_WIDTH = Math.round(WEEK_TIME_COL_WIDTH / 2);
	const weekDayMeta = days.map((d) => ({
		date: d,
		isWorkDay: weekWorkDays.includes(d.getDay()),
	}));
	const workDayCount = weekDayMeta.filter((d) => d.isWorkDay).length;
	const nonWorkDayCount = weekDayMeta.length - workDayCount;
	const weekWorkDayWidth = workDayCount > 0
		? `calc((100% - ${WEEK_TIME_COL_WIDTH}px - ${nonWorkDayCount * WEEK_NON_WORK_COL_WIDTH}px) / ${workDayCount})`
		: `${WEEK_NON_WORK_COL_WIDTH}px`;
	const weekColgroup = isWeekView
		? `
			<colgroup>
				<col style="width: ${WEEK_TIME_COL_WIDTH}px;" />
				${weekDayMeta.map((d) => d.isWorkDay
					? `<col style="width: ${weekWorkDayWidth};" />`
					: `<col style="width: ${WEEK_NON_WORK_COL_WIDTH}px;" />`).join("")}
			</colgroup>
		`
		: "";
	const middleThead = (currentView === "day" || currentView === "week")
		? ""
		: `
			<thead>
				<tr>
					<th class="time-label">Время</th>
					${days.map((d) => {
						if (role === "customer" && startOfDay(d) < todayStart) return "<th></th>";
						return `<th>${toDisplayDate(d)}</th>`;
					}).join("")}
				</tr>
			</thead>
		`;

	const topbarThead = currentView === "week"
		? `
			<thead>
				<tr>
					<th class="time-label"></th>
					${weekDayMeta.map(({ date, isWorkDay }) => {
						const d = date;
						if (role === "customer" && startOfDay(d) < todayStart) return "<th></th>";
						if (!isWorkDay) return '<th class="non-working-day-header"></th>';
						return `<th>${toDisplayDate(d)}</th>`;
					}).join("")}
				</tr>
			</thead>
		`
		: middleThead;

	const rows = timesToRender.map((time) => {
		const cells = dayKeys.map((dayKey) => {
			const dayDate = parseDateKey(dayKey);
			const isPastDay = !!(dayDate && startOfDay(dayDate) < todayStart);
			const isWorkDay = !!(dayDate && weekWorkDays.includes(dayDate.getDay()));

			if (role === "customer" && isPastDay) {
				if (!isWorkDay) return "<td></td>";
				return "<td></td>";
			}
			const key = `${dayKey}T${time}`;
			const slotsInCell = (grouped[key] || [])
				.filter((slot) => !(role === "customer" && isPastSlot(slot)))
				.sort((a, b) => a.id.localeCompare(b.id));
			const isRemovedWorkingCell = dayDate && isWorkDay && !isPastDay && slotsInCell.length === 0;

			if (dayDate && !isWorkDay && slotsInCell.length === 0) {
				if (role === "customer") return "<td></td>";
				return `<td class="non-working-day${isPastDay ? " non-working-day-past" : ""}"></td>`;
			}

			if (isRemovedWorkingCell) {
				if (role === "customer") return "<td></td>";
				return '<td class="non-working-day"></td>';
			}

			if (slotsInCell.length === 0) return "<td></td>";

			const slotsHtml = slotsInCell.map((slot) => {
				const past = isPastSlot(slot);
				const persistedStatus = normalizeStatus(slot.status);
				const draftStatus = role === "executor"
					? (executorDraftStatuses[slot.id] || persistedStatus)
					: (customerDraftStatuses[slot.id] || persistedStatus);
				const attentionClass = shouldHighlightNewRequestSlot(slot.id) ? "new-request-attention" : "";
				const customerRequestReady = role === "customer" && persistedStatus === "free" && draftStatus === "requested";
				const customerAwaitingMaster = role === "customer" && persistedStatus === "requested";
				const customerSlotStateClass = role === "customer"
					? (customerAwaitingMaster
						? "customer-slot customer-slot--requested"
						: (customerRequestReady
							? "customer-slot customer-slot--request-ready"
							: (draftStatus === "free"
								? "customer-slot customer-slot--free"
								: "customer-slot customer-slot--wide")))
					: "";
				const clickable = role === "customer"
					? (!past && persistedStatus === "free" && (draftStatus === "free" || draftStatus === "requested"))
					: canClickSlot({ ...slot, status: draftStatus });
				const canHideUntouched = role === "executor" && !isMasterWeekView && !past && !slot.touched;
				const hideBtnHtml = canHideUntouched
					? `<button type="button" class="slot-hide-btn" data-delete-slot="${slot.id}" title="Сделать слот нерабочим">×</button>`
					: "";
				const canAddExtra = role === "executor" && !isMasterWeekView && !past && slot.kind === "primary"
					&& normalizeStatus(slot.status) === "confirmed"
					&& !slotsInCell.some((s) => s.kind === "extra");
				const addExtraBtnHtml = canAddExtra
					? `<button type="button" class="slot-add-extra-btn" data-add-extra-slot="${slot.id}" title="Добавить свободный слот на это время">+</button>`
					: "";
				const confirmBtnHtml = role === "executor" && !isMasterWeekView && !past && hasStatusDraftChange(slot)
					? `<button type="button" class="slot-confirm-btn" data-confirm-slot="${slot.id}">Подтвердить</button>`
					: "";

				let commentHtml = "";
				if (!isMasterWeekView && (role === "executor" || (role === "customer" && customerAwaitingMaster))) {
					const commentBy = role === "executor" ? "executor" : "customer";
					const showSend = hasCommentDraftChange(slot, commentBy);
					commentHtml = `
						<form class="slot-comment-form" data-comment-slot="${slot.id}" data-comment-by="${commentBy}">
							<input class="slot-comment-input" maxlength="300" value="${getDraftComment(slot, commentBy).replace(/"/g, "&quot;")}" placeholder="Комментарий для мастера" />
							<button type="submit" class="slot-confirm-btn slot-comment-send-btn" ${showSend ? "" : "hidden"}>Отправить</button>
						</form>
					`;
				}

				const visibleHistoryEntries = isMasterWeekView ? [] : getVisibleHistoryEntries(slot);
				const historyHtml = visibleHistoryEntries.length > 0
					? `<ul class="slot-history">${visibleHistoryEntries.map((h) => `<li>${historyEntryText(h, slot)}</li>`).join("")}</ul>`
					: "";

				return `
					<div class="slot-cell ${past ? "past-slot" : ""} ${role === "customer" ? "slot-cell--customer" : ""}">
						${hideBtnHtml}${addExtraBtnHtml}
						<div class="slot-row ${role === "customer" ? "slot-row--customer" : ""}">
							<button
								class="slot ${draftStatus} ${customerSlotStateClass} ${clickable ? "clickable" : ""} ${attentionClass}"
								data-slot-id="${slot.id}"
								${clickable ? "" : "disabled"}
								>
								<span class="slot-label">${getSlotLabel(slot, draftStatus)}</span>
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

	const dayViewClass = currentView === "day" ? " calendar--day" : "";
	calendarWrapper.innerHTML = `<table class="calendar${dayViewClass}">${weekColgroup}${middleThead}<tbody>${rows}</tbody></table>`;
	if (currentView === "week" && role === "executor" && ensureCalendarTopbarHeader()) {
		renderMasterTopbarHeader(topbarThead, weekColgroup);
	} else {
		clearMasterTopbarHeader();
	}
	console.log("renderCalendar done, scheduling autoScroll", { currentView, hasAutoScrolled: hasAutoScrolledToCurrentSlot });
	setTimeout(autoScrollToCurrentSlotRow, 0);

	calendarWrapper.querySelectorAll("[data-slot-id]").forEach((el) => {
		el.addEventListener("click", () => {
			const slot = appState.slots[el.getAttribute("data-slot-id")];
			if (slot) handleSlotClick(slot);
		});
	});

	calendarWrapper.querySelectorAll("[data-delete-slot]").forEach((btn) => {
		const handleDeleteClick = (e) => {
			e.preventDefault();
			e.stopPropagation();
			if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
			if (role !== "executor") return;
			const slotId = btn.getAttribute("data-delete-slot");
			if (!slotId || !appState.slots[slotId]) return;
			socket.emit("executor:hideUntouchedSlot", { slotId });
		};

		btn.addEventListener("pointerdown", (e) => {
			e.preventDefault();
			e.stopPropagation();
			if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
		});

		btn.addEventListener("click", (e) => {
			handleDeleteClick(e);
		});
	});

	calendarWrapper.querySelectorAll("[data-add-extra-slot]").forEach((btn) => {
		btn.addEventListener("pointerdown", (e) => {
			e.preventDefault();
			e.stopPropagation();
			if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
		});
		btn.addEventListener("click", (e) => {
			e.preventDefault();
			e.stopPropagation();
			if (role !== "executor") return;
			const slotId = btn.getAttribute("data-add-extra-slot");
			if (!slotId) return;
			socket.emit("executor:addExtraSlot", { slotId });
		});
	});

	calendarWrapper.querySelectorAll(".slot-confirm-btn[data-confirm-slot]").forEach((btn) => {
		btn.addEventListener("click", (e) => {
			e.preventDefault();
			const slotId = btn.getAttribute("data-confirm-slot");
			if (!slotId || !appState.slots[slotId]) return;
			if (role === "customer") {
				if (!customerIdentityReady()) {
					renderCustomerIdentityGate();
					return;
				}
				const selectedStatus = customerDraftStatuses[slotId] || normalizeStatus(appState.slots[slotId].status);
				socket.emit("customer:confirmSlot", {
					slotId,
					selectedStatus,
					customerName: normalizeCustomerNameInput(customerNameInput ? customerNameInput.value : ""),
					customerPhone: normalizeCustomerPhoneInput(customerPhoneInput ? customerPhoneInput.value : ""),
				});
				setHint("Запрос отправлен.");
				return;
			}
			const selectedStatus = executorDraftStatuses[slotId] || normalizeStatus(appState.slots[slotId].status);
			socket.emit("executor:confirmSlot", { slotId, selectedStatus });
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
			if (commentBy !== "executor") setHint("Комментарий сохранен.");
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
		if (weekLabel) weekLabel.classList.add("day-indicator-label");
		if (weekPrevBtn) {
			weekPrevBtn.textContent = "←";
			weekPrevBtn.disabled = role === "customer"
				? !findPreviousCustomerAvailableDay(addDays(currentDay, -1))
				: currentDay <= rangeStartDay;
		}
		if (weekNextBtn) {
			weekNextBtn.textContent = "→";
			weekNextBtn.disabled = role === "customer"
				? !findNextCustomerAvailableDay(addDays(currentDay, 1))
				: currentDay >= rangeEndDay;
		}
	} else {
		if (weekLabel) weekLabel.textContent = weekLabelText(currentWeekStart);
		if (weekLabel) weekLabel.classList.remove("day-indicator-label");
		if (weekPrevBtn) {
			weekPrevBtn.textContent = "←";
			weekPrevBtn.disabled = role === "customer"
				? !findPreviousCustomerAvailableDay(addDays(currentWeekStart, -1))
				: currentWeekStart <= rangeStartWeek;
		}
		if (weekNextBtn) {
			weekNextBtn.textContent = "→";
			weekNextBtn.disabled = role === "customer"
				? !findNextCustomerAvailableDay(addDays(currentWeekStart, 7))
				: currentWeekStart >= rangeEndWeek;
		}
	}

	if (role === "executor" && settingsForm) {
		const wk = dateKey(currentWeekStart);
		const selected = Array.isArray(appState.weekWorkDays?.[wk]) ? appState.weekWorkDays[wk] : [];
		const todayStart = startOfDay(currentNow());
		const localMasterProfile = readStoredProfile(MASTER_PROFILE_STORAGE_KEY);
		const persistedMasterName = String(appState.settings?.masterName || "");
		const persistedMasterPhone = normalizePhoneOrEmpty(appState.settings?.masterPhone || "");

		// Only overwrite form inputs if no unsaved changes (prevents losing user edits on state update)
		const hasUnsaved = settingsSavedSnapshot && getSettingsSnapshot() !== settingsSavedSnapshot;
		if (!hasUnsaved) {
			if (masterNameInput) {
				masterNameInput.value = persistedMasterName || String(localMasterProfile.name || "");
			}
			if (masterPhoneInput) {
				masterPhoneInput.value = persistedMasterPhone || normalizePhoneOrEmpty(localMasterProfile.phone || "");
			}
			saveMasterProfileToStorage();
			if (workStartHourInput) workStartHourInput.value = String(appState.settings?.startHour ?? 9);
			if (workEndHourInput) workEndHourInput.value = String(appState.settings?.endHour ?? 18);
		}

		settingsForm.querySelectorAll('input[name="workDay"]').forEach((el) => {
			el.checked = selected.includes(Number(el.value));
			
			// Disable checkboxes for past days
			const dayDate = dateForWeekDay(currentWeekStart, Number(el.value));
			const isPastDay = startOfDay(dayDate) < todayStart;
			el.disabled = isPastDay;
			el.closest(".day-label").style.opacity = isPastDay ? "0.5" : "1";
		});
		markSettingsSnapshotSaved();
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
	if (role === "customer" && !customerIdentityReady()) {
		renderCustomerIdentityGate();
		return;
	}
	if (currentView === "month") {
		renderMonthView();
	} else {
		renderCalendar();
	}
}

function renderMonthView() {
	if (role === "customer" && !customerIdentityReady()) {
		renderCustomerIdentityGate();
		return;
	}
	clearMasterTopbarHeader();
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
			saveViewState();
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
		if (role === "customer") alignCustomerViewToAvailableSlots(-1);
		saveViewState();
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
		if (role === "customer") alignCustomerViewToAvailableSlots(1);
		saveViewState();
		renderWeekControls();
		renderCalendar();
	});
}

if (customerPhoneInput) {
	customerPhoneInput.addEventListener("focus", () => {
		if (!customerPhoneInput.value.trim()) customerPhoneInput.value = PHONE_PREFIX;
		saveCustomerProfileToStorage();
	});
	customerPhoneInput.addEventListener("input", () => {
		customerPhoneInput.value = normalizeCustomerPhoneInput(customerPhoneInput.value);
		syncCustomerIdentityGate();
		saveCustomerProfileToStorage();
	});
	customerPhoneInput.addEventListener("change", () => {
		customerPhoneInput.value = normalizeCustomerPhoneInput(customerPhoneInput.value);
		syncCustomerIdentityGate();
		saveCustomerProfileToStorage();
	});
	customerPhoneInput.addEventListener("blur", () => {
		customerPhoneInput.value = normalizeCustomerPhoneInput(customerPhoneInput.value);
		syncCustomerIdentityGate();
		saveCustomerProfileToStorage();
	});
}

if (customerNameInput) {
	customerNameInput.addEventListener("input", () => {
		customerNameInput.value = normalizeCustomerNameInput(customerNameInput.value);
		syncCustomerIdentityGate();
		saveCustomerProfileToStorage();
	});
	customerNameInput.addEventListener("change", () => {
		customerNameInput.value = normalizeCustomerNameInput(customerNameInput.value);
		syncCustomerIdentityGate();
		saveCustomerProfileToStorage();
	});
	customerNameInput.addEventListener("blur", () => {
		customerNameInput.value = normalizeCustomerNameInput(customerNameInput.value);
		syncCustomerIdentityGate();
		saveCustomerProfileToStorage();
	});
}

if (masterNameInput) {
	masterNameInput.addEventListener("input", () => {
		masterNameInput.value = String(masterNameInput.value || "").replace(/\s+/g, " ").trimStart();
		saveMasterProfileToStorage();
	});
	masterNameInput.addEventListener("change", () => {
		masterNameInput.value = String(masterNameInput.value || "").replace(/\s+/g, " ").trim();
		saveMasterProfileToStorage();
	});
	masterNameInput.addEventListener("blur", () => {
		masterNameInput.value = String(masterNameInput.value || "").replace(/\s+/g, " ").trim();
		saveMasterProfileToStorage();
	});
}

if (settingsForm) {
	setSettingsSubmitVisible(false);
	settingsForm.addEventListener("input", () => {
		refreshSettingsSubmitVisibility();
	});
	settingsForm.addEventListener("change", () => {
		refreshSettingsSubmitVisibility();
	});

	settingsForm.addEventListener("submit", (event) => {
		event.preventDefault();
		if (role !== "executor") return;
		saveMasterProfileToStorage();

		const startHour = Number(workStartHourInput ? workStartHourInput.value : appState.settings?.startHour ?? 9);
		const endHour = Number(workEndHourInput ? workEndHourInput.value : appState.settings?.endHour ?? 18);

		const payload = {
			masterName: String(masterNameInput ? masterNameInput.value : "").trim(),
			masterPhone: String(masterPhoneInput ? masterPhoneInput.value : "").trim(),
			masterAddress: String(masterAddressInput ? masterAddressInput.value : "").replace(/\s+/g, " ").trim(),
			startHour,
			endHour,
		};
		console.log("[settings save] sending:", JSON.stringify(payload));

		fetch("/api/settings", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		}).then((r) => {
			console.log("[settings save] response status:", r.status);
			return r.json();
		}).then((data) => {
			console.log("[settings save] response data:", JSON.stringify(data));
			if (data.error) { setHint(data.error); return; }
			setHint("Настройки сохранены ✓");
			markSettingsSnapshotSaved();
		}).catch((err) => {
			console.error("[settings save] error:", err);
			setHint("Ошибка сохранения настроек.");
		});

		const workDays = Array.from(settingsForm.querySelectorAll('input[name="workDay"]:checked')).map((el) => Number(el.value));
		socket.emit("executor:updateWeekWorkDays", {
			weekStart: dateKey(currentWeekStart),
			workDays,
		});
	});
}

if (masterPhoneInput) {
	masterPhoneInput.addEventListener("focus", () => {
		if (!masterPhoneInput.value.trim()) masterPhoneInput.value = PHONE_PREFIX;
		saveMasterProfileToStorage();
	});
	masterPhoneInput.addEventListener("input", () => {
		masterPhoneInput.value = normalizeCustomerPhoneInput(masterPhoneInput.value);
		saveMasterProfileToStorage();
	});
	masterPhoneInput.addEventListener("change", () => {
		masterPhoneInput.value = normalizeCustomerPhoneInput(masterPhoneInput.value);
		saveMasterProfileToStorage();
	});
	masterPhoneInput.addEventListener("blur", () => {
		masterPhoneInput.value = normalizeCustomerPhoneInput(masterPhoneInput.value);
		saveMasterProfileToStorage();
	});
}

if (masterAddressInput) {
	masterAddressInput.addEventListener("input", () => {
		masterAddressInput.value = String(masterAddressInput.value || "").replace(/\s+/g, " ").trimStart();
		saveMasterProfileToStorage();
	});
	masterAddressInput.addEventListener("change", () => {
		masterAddressInput.value = String(masterAddressInput.value || "").replace(/\s+/g, " ").trim();
		saveMasterProfileToStorage();
	});
	masterAddressInput.addEventListener("blur", () => {
		masterAddressInput.value = String(masterAddressInput.value || "").replace(/\s+/g, " ").trim();
		saveMasterProfileToStorage();
	});
}

if (masterSettingsBtn) {
	masterSettingsBtn.addEventListener("click", () => {
		scrollToMasterSettings();
	});
}

socket.on("state", (nextState) => {
	lastStateReceivedAt = Date.now();
	console.log("[state received] settings:", JSON.stringify(nextState.settings));
	const shouldTrackNewRequests = hasReceivedInitialState;
	const newRequestedSlotId = shouldTrackNewRequests ? findNewCustomerRequestedSlotId(appState, nextState) : "";
	appState = nextState;
	updateCustomerMasterInfo();
	executorDraftStatuses = {};
	customerDraftStatuses = {};
	executorDraftComments = {};
	customerDraftComments = {};
	restoreViewState();
	if (role === "customer") {
		alignCustomerViewToAvailableSlots(1);
	}
	updateViewUI();
	if (role === "customer" && !customerIdentityReady()) {
		renderCustomerIdentityGate();
	} else {
		renderWeekControls();
		renderView();
		if (role === "customer") {
			setHint("Выберите время для записи");
		}
	}
	if (newRequestedSlotId) {
		focusNewRequestedSlot(newRequestedSlotId);
	}
	updateSettingsCompactMode();
	hasReceivedInitialState = true;
});

socket.on("connect", () => {
	requestLatestState("connect");
});

socket.on("error:message", (message) => {
	setHint(message);
});

document.addEventListener("visibilitychange", () => {
	if (document.visibilityState === "visible") {
		requestLatestState("visibilitychange");
	}
});

window.addEventListener("focus", () => {
	requestLatestState("focus");
});

window.addEventListener("online", () => {
	requestLatestState("online");
});

window.addEventListener("pageshow", (event) => {
	if (event.persisted) {
		window.location.reload();
		return;
	}
	requestLatestState("pageshow");
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
		saveViewState();
		updateViewUI();
		renderWeekControls();
		renderCalendar();
	});
}

if (viewWeekBtn) {
	viewWeekBtn.addEventListener("click", () => {
		currentView = "week";
		currentWeekStart = startOfWeek(currentDay);
		saveViewState();
		updateViewUI();
		renderWeekControls();
		renderCalendar();
	});
}

if (viewMonthBtn) {
	viewMonthBtn.addEventListener("click", () => {
		currentView = "month";
		saveViewState();
		currentMonthStart = startOfMonth(currentWeekStart);
		updateViewUI();
		renderMonthView();
	});
}

if (monthPrevBtn) {
	monthPrevBtn.addEventListener("click", () => {
		currentMonthStart = new Date(currentMonthStart.getFullYear(), currentMonthStart.getMonth() - 1, 1);
		saveViewState();
		if (monthLabelEl) monthLabelEl.textContent = monthLabelText(currentMonthStart);
		renderMonthView();
	});
}

if (monthNextBtn) {
	monthNextBtn.addEventListener("click", () => {
		saveViewState();
		currentMonthStart = new Date(currentMonthStart.getFullYear(), currentMonthStart.getMonth() + 1, 1);
		if (monthLabelEl) monthLabelEl.textContent = monthLabelText(currentMonthStart);
		renderMonthView();
	});
}

syncAppVersion();
loadCustomerProfileFromStorage();
loadMasterProfileFromStorage();
updateCustomerMasterInfo();
ensureCustomerLiveSync();

if (customerPhoneInput && !customerPhoneInput.value.trim()) {
	customerPhoneInput.value = PHONE_PREFIX;
	saveCustomerProfileToStorage();
}

updateMasterLayoutOffset();
updateSettingsCompactMode();
syncCustomerIdentityGate();
setTimeout(syncCustomerIdentityGate, 150);
setTimeout(syncCustomerIdentityGate, 800);

if (customerIdentityReady() && role !== "executor") {
	setHint("Клиент: доступны только ближайшие 10 дней.");
}
