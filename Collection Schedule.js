(function () {
  var COLLECTION_DAYS = ["Monday", "Tuesday", "Thursday", "Friday", "Saturday", "Sunday"];
  var FULL_WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  var DAY_SHORT = { Monday: "Mon", Tuesday: "Tue", Wednesday: "Wed", Thursday: "Thu", Friday: "Fri", Saturday: "Sat", Sunday: "Sun" };
  var HOURS = "8:00 AM \u2013 5:00 PM";
  var UPCOMING_COUNT = 5;

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  function nextDateForDay(dayName) {
    var today = new Date();
    var target = FULL_WEEK.indexOf(dayName);
    var targetJsIndex = (target + 1) % 7;
    var diff = (targetJsIndex - today.getDay() + 7) % 7;
    var date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + diff);
    return { date: date, diff: diff };
  }

  function fmtShort(date) {
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  function emptyState(icon, title, sub) {
    return '<div class="mysched-empty"><i class="fa-solid ' + icon + '"></i><strong>' + title + '</strong><span>' + sub + '</span></div>';
  }

  function parseDbDate(value) {
    if (!value) return null;
    var text = String(value);
    var plain = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (plain) return new Date(Number(plain[1]), Number(plain[2]) - 1, Number(plain[3]));
    var parsed = new Date(text);
    if (isNaN(parsed.getTime())) return null;
    return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
  }

  function fmtTime(value) {
    if (!value) return "";
    var match = String(value).match(/^(\d{1,2}):(\d{2})/);
    if (!match) return String(value);
    var hour = Number(match[1]);
    var suffix = hour >= 12 ? "PM" : "AM";
    var hour12 = hour % 12 === 0 ? 12 : hour % 12;
    return hour12 + ":" + match[2] + " " + suffix;
  }

  function hoursForRow(row) {
    var start = fmtTime(row.start_time);
    var end = fmtTime(row.end_time);
    if (start && end) return start + " \u2013 " + end;
    return HOURS;
  }

  function daysFromToday(date) {
    var now = new Date();
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.round((date - today) / 86400000);
  }

  function dayNameForDate(date) {
    return FULL_WEEK[(date.getDay() + 6) % 7];
  }

  function statusLabel(value) {
    var text = String(value || "Scheduled").replace(/_/g, " ");
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  // The resident's street now comes from the database instead of the
  // ecoUsers map, so a street edited on any device shows up here.
  async function registeredStreet(session) {
    if (!session) return "";
    if (session.street) return session.street;
    if (!window.EcoApi) return "";

    var residentId = window.EcoApi.residentId();
    if (!residentId) return "";

    var res = await window.EcoApi.get("/api/residents/" + encodeURIComponent(residentId));
    if (!res || res.offline || !res.success || !res.resident) return "";

    return res.resident.street || "";
  }

  function dayForStreet(entry) {
    var day = String(entry && entry.collection_day || "");
    return FULL_WEEK.indexOf(day) === -1 ? "" : day;
  }

  function findStreet(streets, street) {
    var wanted = String(street || "").trim().toLowerCase();

    for (var i = 0; i < streets.length; i++) {
      var name = String(streets[i] && (streets[i].street || streets[i].name) || "").trim().toLowerCase();
      if (name && name === wanted) return streets[i];
    }

    return null;
  }

  function buildHeroAndStrip(street, day, next, hours, statLabel, statValue) {
    var isToday = next.diff === 0;
    var countdown = isToday ? "Today!" : next.diff === 1 ? "Tomorrow" : "In " + next.diff + " days";

    var strip = FULL_WEEK.map(function (weekDay) {
      var isOff = COLLECTION_DAYS.indexOf(weekDay) === -1;
      var isMine = weekDay === day;
      var isDayToday = nextDateForDay(weekDay).diff === 0;
      var classes = ["mysched-pill"];
      if (isOff) classes.push("off");
      if (isDayToday) classes.push("today");
      if (isMine) classes.push("mine");
      var icon = isOff ? "fa-ban" : (isMine ? "fa-truck-fast" : "fa-recycle");
      return '<div class="' + classes.join(" ") + '">' +
        (isMine ? '<span class="p-tag">Your day</span>' : "") +
        '<span class="p-day">' + DAY_SHORT[weekDay] + '</span>' +
        '<span class="p-icon"><i class="fa-solid ' + icon + '"></i></span></div>';
    }).join("");

    return '<div class="mysched-hero' + (isToday ? " today" : "") + '">' +
        '<div class="mysched-hero-top">' +
          '<span class="mysched-kicker"><i class="fa-solid fa-location-dot"></i> ' + esc(street) + '</span>' +
          '<span class="mysched-countdown' + (isToday ? " today" : "") + '"><i class="fa-solid ' + (isToday ? "fa-bell" : "fa-clock") + '"></i> ' + countdown + '</span>' +
        '</div>' +
        '<div class="mysched-hero-day">' + day + ' Collection</div>' +
        '<div class="mysched-hero-sub">' + fmtShort(next.date) + ' &middot; ' + esc(hours) + '</div>' +
        '<div class="mysched-hero-stats">' +
          '<div class="mysched-stat"><span>Street</span><strong title="' + esc(street) + '">' + esc(street) + '</strong></div>' +
          '<div class="mysched-stat"><span>' + statLabel + '</span><strong>' + esc(statValue) + '</strong></div>' +
          '<div class="mysched-stat"><span>Hours</span><strong>' + esc(hours) + '</strong></div>' +
        '</div>' +
      '</div>' +
      '<div class="mysched-strip">' + strip + '</div>';
  }

  function buildUpcomingRow(day, date, diff, hours, detail, isFirst) {
    var full = date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
    var title = diff === 0 ? "Today" : full;
    var when = diff === 0 ? full : (diff === 1 ? "Tomorrow" : "In " + diff + " days");

    return '<div class="schedule-row' + (isFirst ? " next" : "") + '">' +
        '<div class="schedule-day"><span class="day-name">' + DAY_SHORT[day] + '</span><span class="day-num">' + date.getDate() + '</span></div>' +
        '<div class="schedule-info">' +
          '<span class="schedule-title">' + esc(title) + '</span>' +
          '<span class="schedule-meta">' + esc(when) + ' &middot; ' + esc(hours) + ' &middot; ' + esc(detail) + '</span>' +
        '</div>' +
        (isFirst ? '<span class="badge badge-next">' + (diff === 0 ? "Today" : "Next up") + '</span>' : "") +
      '</div>';
  }

  async function fetchMysqlSchedules(session) {
    if (!session) return null;

    // residentId comes from the shared api-client so either session
    // field name (residentId / resident_id) resolves.
    var residentId = window.EcoApi ? window.EcoApi.residentId() : session.residentId;
    if (!residentId) return null;

    try {
      var response = await fetch("/api/residents/" + encodeURIComponent(residentId) + "/schedule");
      var data = await response.json();

      if (!response.ok || !data.success || !Array.isArray(data.schedules)) return null;

      return data.schedules;
    } catch (error) {
      console.error("Schedule MySQL error:", error);
      return null;
    }
  }

  function renderFromMysql(host, tag, upPanel, street, rows) {
    // The publish endpoint can leave the same date on a street more than
    // once, so keep one row per collection date + start time.
    var seen = {};
    var items = rows.map(function (row) {
      var date = parseDbDate(row.collection_date);
      return date ? { row: row, date: date, diff: daysFromToday(date) } : null;
    }).filter(function (item) {
      if (!item || item.diff < 0) return false;
      if (/cancel|complete/i.test(String(item.row.schedule_status || ""))) return false;
      var key = item.row.collection_date + " " + String(item.row.start_time || "");
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    }).sort(function (a, b) {
      return a.date - b.date;
    });

    if (!items.length) {
      host.innerHTML = emptyState("fa-calendar-xmark", "No upcoming collection scheduled.", "Check back soon \u2014 the Barangay will post your next collection date here.");
      return;
    }

    var first = items[0];
    var heroStreet = street || first.row.street || "";
    var day = dayNameForDate(first.date);
    var hours = hoursForRow(first.row);

    host.innerHTML = buildHeroAndStrip(
      heroStreet,
      day,
      { date: first.date, diff: first.diff },
      hours,
      "Status",
      statusLabel(first.row.schedule_status)
    );

    tag.textContent = "Barangay Schedule \u00b7 " + hours;

    var rowsHtml = items.slice(0, UPCOMING_COUNT).map(function (item, i) {
      return buildUpcomingRow(
        dayNameForDate(item.date),
        item.date,
        item.diff,
        hoursForRow(item.row),
        statusLabel(item.row.schedule_status),
        i === 0
      );
    });

    document.getElementById("upcomingTag").textContent = rowsHtml.length + " upcoming";
    document.getElementById("upcomingSub").textContent =
      "Upcoming collection dates for " + heroStreet + " from the Barangay schedule.";
    document.getElementById("upcomingList").innerHTML = rowsHtml.join("");
    upPanel.hidden = false;
  }

  // Fallback used when the Barangay has not published a dated schedule
  // for this resident: derive the recurring collection day straight
  // from the street's row in the database.
  function renderFromStreets(host, tag, upPanel, street, streets) {
    var entry = findStreet(streets, street);

    if (!entry) {
      host.innerHTML = emptyState("fa-location-dot", esc(street) + " isn't on the Caniogan street list.", 'Update your street on <a href="Profile.html">your Profile</a> to see your collection day.');
      return;
    }

    var day = dayForStreet(entry);

    if (!day) {
      host.innerHTML = emptyState("fa-truck-ramp-box", esc(street) + " isn't assigned to a collection day yet.", "Check back soon \u2014 the Barangay is still finalizing collector routes.");
      return;
    }

    var groupName = entry.group_name || (entry.group_number ? "Group " + entry.group_number : "Barangay collection team");

    var next = nextDateForDay(day);

    host.innerHTML = buildHeroAndStrip(street, day, next, HOURS, "Collector Team", groupName);

    tag.textContent = groupName + " \u00b7 " + HOURS;

    var rows = [];
    for (var i = 0; i < UPCOMING_COUNT; i++) {
      var d = new Date(next.date.getFullYear(), next.date.getMonth(), next.date.getDate() + i * 7);
      rows.push(buildUpcomingRow(day, d, next.diff + i * 7, HOURS, groupName, i === 0));
    }

    document.getElementById("upcomingTag").textContent = "Every " + day;
    document.getElementById("upcomingSub").textContent =
      street + " is collected every " + day + " by " + groupName + ".";
    document.getElementById("upcomingList").innerHTML = rows.join("");
    upPanel.hidden = false;
  }

  function showScheduleNote(message, detail) {
    var host = document.getElementById("myScheduleCard");
    if (!host) return;
    host.innerHTML = emptyState("fa-server", esc(message), detail);
  }

  // The Barangay's own schedule table, used when nothing has been
  // published to this resident yet. Same row shape as the resident
  // schedule, so renderFromMysql can draw it unchanged.
  async function fetchAdminSchedules() {
    if (!window.EcoApi) return null;

    var res = await window.EcoApi.get("/api/collection-schedules?role=admin");
    if (!res || res.offline || !res.success || !Array.isArray(res.schedules)) return null;

    return res.schedules;
  }

  function schedulesForStreet(rows, street) {
    var wanted = String(street || "").trim().toLowerCase();

    return rows.filter(function (row) {
      var name = String(row && row.street || "").trim().toLowerCase();
      return name && name === wanted;
    });
  }

  function hasUpcomingDate(rows) {
    return rows.some(function (row) {
      var date = parseDbDate(row.collection_date);
      return date && daysFromToday(date) >= 0;
    });
  }

  async function render() {
    var host = document.getElementById("myScheduleCard");
    var tag = document.getElementById("myScheduleTag");
    var upPanel = document.getElementById("upcomingPanel");
    if (!host) return;

    upPanel.hidden = true;
    tag.textContent = "Set by the Barangay";

    var session = window.EcoApi ? window.EcoApi.session() : null;
    if (!session) {
      host.innerHTML = emptyState("fa-right-to-bracket", "Log in to see your schedule.", '<a href="Registration.html">Log in</a> to see the collection day for your registered street.');
      return;
    }

    var street = await registeredStreet(session);
    var rows = await fetchMysqlSchedules(session);

    if (rows && rows.length) {
      renderFromMysql(host, tag, upPanel, street, rows);
      return;
    }

    if (!street) {
      host.innerHTML = emptyState("fa-location-dot", "No registered street on file.", 'Add your street on <a href="Profile.html">your Profile</a> to see your personal collection day.');
      return;
    }

    if (!window.EcoApi) {
      showScheduleNote(
        "Schedule unavailable.",
        'Start the EcoPoints server with "npm start" and refresh this page.'
      );
      return;
    }

    var adminRows = await fetchAdminSchedules();
    var streetRows = adminRows ? schedulesForStreet(adminRows, street) : [];

    if (hasUpcomingDate(streetRows)) {
      renderFromMysql(host, tag, upPanel, street, streetRows);
      return;
    }

    var streetsRes = await window.EcoApi.get("/api/streets");

    if (!streetsRes || streetsRes.offline || !streetsRes.success) {
      tag.textContent = streetsRes && streetsRes.offline ? "Server offline" : "Schedule unavailable";
      showScheduleNote(
        "Schedule unavailable.",
        'The EcoPoints server is not responding. Start it with "npm start", then refresh this page.'
      );
      return;
    }

    renderFromStreets(host, tag, upPanel, street, streetsRes.streets || []);
  }

  window.addEventListener("storage", function (event) {
    if (event.key === "ecoUser") render();
  });

  document.addEventListener("DOMContentLoaded", render);
})();
