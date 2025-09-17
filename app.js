if ("serviceWorker" in navigator && "PushManager" in window) {
  navigator.serviceWorker.register("/sw.js").then(function (registration) {
    console.log("Service Worker registered", registration);
  });
}

Notification.requestPermission().then(function (permission) {
  if (permission === "granted") {
    console.log("Notification permission granted.");
  } else {
    console.log("Notification permission denied.");
  }
});

const response = await fetch("/vapidPublicKey");
const vapidPublicKey = await response.text();
