(function initAppDates(global) {
	const WEEKDAY_LABELS = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
	const WEEKDAY_LABELS_FULL = ["ВОСКРЕСЕНЬЕ", "ПОНЕДЕЛЬНИК", "ВТОРНИК", "СРЕДА", "ЧЕТВЕРГ", "ПЯТНИЦА", "СУББОТА"];
	const WEEKDAY_LABELS_LOWER = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];
	const MONTH_NAMES = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
	const MONTH_NAMES_GENITIVE = ["ЯНВАРЯ", "ФЕВРАЛЯ", "МАРТА", "АПРЕЛЯ", "МАЯ", "ИЮНЯ", "ИЮЛЯ", "АВГУСТА", "СЕНТЯБРЯ", "ОКТЯБРЯ", "НОЯБРЯ", "ДЕКАБРЯ"];
	const MONTH_NAMES_GENITIVE_LOWER = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

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
		return `${WEEKDAY_LABELS_FULL[day.getDay()]}, ${day.getDate()} ${MONTH_NAMES_GENITIVE[day.getMonth()]}`;
	}

	function formatDayForDisplay(date) {
		const dayName = WEEKDAY_LABELS_LOWER[date.getDay()];
		return `${dayName}, ${date.getDate()} ${MONTH_NAMES_GENITIVE_LOWER[date.getMonth()]}`;
	}

	global.AppDates = Object.freeze({
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
	});
})(window);
