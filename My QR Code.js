requireAuth();

async function loadQrResident() {
  const session = getSession();

  if (!session || !session.residentId) {
    return null;
  }

  try {
    const response = await fetch(
      `/api/residents/${encodeURIComponent(session.residentId)}`
    );

    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.error || "Failed to load resident data.");
    }

    return data.resident;
  } catch (error) {
    console.error("QR MySQL error:", error);

    return null;
  }
}

function syncQrIdentity() {
  const name = getUserName();

  const initials = name
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  document
    .querySelectorAll(".profile-name")
    .forEach((el) => (el.textContent = name));

  document
    .querySelectorAll(".avatar")
    .forEach((el) => (el.textContent = initials));
}

async function renderQrCode() {
  syncQrIdentity();

  const qrBox = document.getElementById("qrBox");

  const resident = await loadQrResident();

  let accountId;
  let qrValue;
  let displayName;

  if (resident) {
    accountId = resident.account_id;
    qrValue = resident.qr_code_value || resident.account_id;
    displayName =
      `${resident.first_name || ""} ${resident.last_name || ""}`.trim() ||
      getUserName();
  } else {
    accountId = getUserId();
    qrValue = accountId;
    displayName = getUserName();
  }

  document.getElementById("qrUserId").textContent = accountId;
  document.getElementById("qrUserName").textContent = displayName;

  qrBox.innerHTML = "";

  new QRCode(qrBox, {
    text: "ECOPOINTS-USER:" + qrValue,
    width: 180,
    height: 180,
    colorDark: "#2E3F16",
    colorLight: "#ffffff",
  });

  document.getElementById("downloadBtn").onclick = () => {
    const canvas = qrBox.querySelector("canvas");

    if (!canvas) return;

    const link = document.createElement("a");

    link.download = "ecopoints-qr-" + accountId + ".png";
    link.href = canvas.toDataURL("image/png");
    link.click();
  };
}

document.addEventListener("DOMContentLoaded", renderQrCode);
