(function initAppStorage(global) {
	const MASTER_VIEW_STATE_KEY = "masterViewState";

	function readStoredProfile(storageKey) {
		try {
			const raw = localStorage.getItem(storageKey);
			if (!raw) return { name: "", phone: "", address: "" };
			const parsed = JSON.parse(raw);
			return {
				name: String(parsed?.name || ""),
				phone: String(parsed?.phone || ""),
				address: String(parsed?.address || ""),
			};
		} catch (e) {
			return { name: "", phone: "", address: "" };
		}
	}

	function saveViewState({ currentView, currentDay, currentWeekStart, currentMonthStart, dateKey, storageKey = MASTER_VIEW_STATE_KEY }) {
		const state = {
			view: currentView,
			day: dateKey(currentDay),
			weekStart: dateKey(currentWeekStart),
			monthStart: dateKey(currentMonthStart),
		};
		try {
			localStorage.setItem(storageKey, JSON.stringify(state));
		} catch (e) {
			console.warn("Failed to save view state:", e);
		}
	}

	function restoreViewState({ role, parseDateKey, startOfDay, startOfWeek, currentNow, storageKey = MASTER_VIEW_STATE_KEY }) {
		try {
			const saved = localStorage.getItem(storageKey);
			if (!saved) return null;
			const state = JSON.parse(saved);
			const restored = { rawState: state };

			if (state.view) restored.currentView = state.view;
			if (state.day) {
				const day = parseDateKey(state.day);
				if (day) restored.currentDay = day;
			}
			if (state.weekStart) {
				const week = parseDateKey(state.weekStart);
				if (week) restored.currentWeekStart = week;
			}
			if (state.monthStart) {
				const month = parseDateKey(state.monthStart);
				if (month) restored.currentMonthStart = month;
			}

			if (role === "customer") {
				restored.currentView = "day";
				restored.currentDay = startOfDay(currentNow());
				restored.currentWeekStart = startOfWeek(restored.currentDay);
			}

			return restored;
		} catch (e) {
			console.warn("Failed to restore view state:", e);
			return null;
		}
	}

	function saveCustomerProfileToStorage({
		customerNameInput,
		customerPhoneInput,
		normalizeCustomerNameInput,
		normalizePhoneOrEmpty,
		storageKey,
	}) {
		if (!customerNameInput || !customerPhoneInput) return;
		try {
			const profile = {
				name: normalizeCustomerNameInput(customerNameInput.value),
				phone: normalizePhoneOrEmpty(customerPhoneInput.value),
			};
			localStorage.setItem(storageKey, JSON.stringify(profile));
		} catch (e) {
			console.warn("Failed to save customer profile:", e);
		}
	}

	function loadCustomerProfileFromStorage({
		customerNameInput,
		customerPhoneInput,
		normalizeCustomerNameInput,
		normalizePhoneOrEmpty,
		storageKey,
	}) {
		if (!customerNameInput || !customerPhoneInput) return;
		const profile = readStoredProfile(storageKey);
		customerNameInput.value = normalizeCustomerNameInput(profile.name);
		customerPhoneInput.value = normalizePhoneOrEmpty(profile.phone);
	}

	function saveMasterProfileToStorage({
		masterNameInput,
		masterPhoneInput,
		masterAddressInput,
		normalizePhoneOrEmpty,
		storageKey,
	}) {
		if (!masterNameInput || !masterPhoneInput) return;
		try {
			const profile = {
				name: String(masterNameInput.value || "").replace(/\s+/g, " ").trim(),
				phone: normalizePhoneOrEmpty(masterPhoneInput.value),
				address: String(masterAddressInput ? masterAddressInput.value : "").replace(/\s+/g, " ").trim(),
			};
			localStorage.setItem(storageKey, JSON.stringify(profile));
		} catch (e) {
			console.warn("Failed to save master profile:", e);
		}
	}

	function loadMasterProfileFromStorage({
		masterNameInput,
		masterPhoneInput,
		masterAddressInput,
		normalizePhoneOrEmpty,
		storageKey,
	}) {
		if (!masterNameInput || !masterPhoneInput) return;
		const profile = readStoredProfile(storageKey);
		masterNameInput.value = String(profile.name || "").replace(/\s+/g, " ").trim();
		masterPhoneInput.value = normalizePhoneOrEmpty(profile.phone);
		if (masterAddressInput) {
			masterAddressInput.value = String(profile.address || "").replace(/\s+/g, " ").trim();
		}
	}

	function syncAppVersion({ runtimeVersion, storageKey }) {
		if (!runtimeVersion) return;
		try {
			const previousVersion = String(localStorage.getItem(storageKey) || "").trim();
			if (previousVersion !== runtimeVersion) {
				localStorage.setItem(storageKey, runtimeVersion);
			}
		} catch (e) {
			console.warn("Failed to sync app version:", e);
		}
	}

	global.AppStorage = Object.freeze({
		readStoredProfile,
		saveViewState,
		restoreViewState,
		saveCustomerProfileToStorage,
		loadCustomerProfileFromStorage,
		saveMasterProfileToStorage,
		loadMasterProfileFromStorage,
		syncAppVersion,
	});
})(window);
