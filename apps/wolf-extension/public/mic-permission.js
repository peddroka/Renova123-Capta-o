const status = document.querySelector("#status");
const error = document.querySelector("#error");
const button = document.querySelector("#allow");
button.addEventListener("click", () => {
  button.disabled = true;
  status.textContent = "Solicitando permissão…";
  error.textContent = "";
  void navigator.mediaDevices.getUserMedia({ audio: true, video: false }).then((stream) => {
    const tracks = stream.getAudioTracks();
    const track = tracks[0];
    if (!stream || tracks.length === 0 || !track || track.readyState !== "live") throw new Error("MIC_STREAM_NOT_LIVE");
    stream.getTracks().forEach((track) => track.stop());
    status.textContent = "Microfone autorizado. Você pode voltar ao THE WOLF.";
    chrome.runtime.sendMessage({ type: "MIC_PERMISSION_GRANTED", method: "permission-page" }).catch(() => undefined);
    setTimeout(() => window.close(), 500);
  }).catch((cause) => {
    const name = cause?.name || "Error";
    const message = cause?.message || String(cause);
    const type = name === "NotAllowedError" && /dismiss/i.test(message) ? "MIC_PERMISSION_CANCELLED" : name === "NotAllowedError" ? "MIC_PERMISSION_DENIED" : "MIC_PERMISSION_ERROR";
    chrome.runtime.sendMessage({ type, method: "permission-page", name, message }).catch(() => undefined);
    error.textContent = name === "NotAllowedError" ? "Microfone ainda não autorizado." : "Não foi possível liberar o microfone.";
    button.disabled = false;
  });
});
