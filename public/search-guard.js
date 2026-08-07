const form = document.querySelector("#search-form");
const button = form?.querySelector('button[type="submit"]');
const notice = document.querySelector("#search-notice");

let busy = false;
let releaseTimer = null;
let observer = null;

function releaseSearchButton() {
  busy = false;
  clearTimeout(releaseTimer);
  observer?.disconnect();
  observer = null;

  if (button) {
    button.disabled = false;
    button.textContent = button.dataset.idleLabel || "Go Hunting";
  }
}

if (form && button && notice) {
  button.dataset.idleLabel = button.textContent;

  form.addEventListener("submit", (event) => {
    if (busy) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }

    busy = true;
    button.disabled = true;
    button.textContent = "Hunting…";

    observer = new MutationObserver(() => {
      if (notice.classList.contains("good") || notice.classList.contains("bad")) {
        releaseSearchButton();
      }
    });

    observer.observe(notice, {
      attributes: true,
      attributeFilter: ["class"],
      childList: true,
      characterData: true,
      subtree: true
    });

    releaseTimer = setTimeout(releaseSearchButton, 16_000);
  }, { capture: true });
}
