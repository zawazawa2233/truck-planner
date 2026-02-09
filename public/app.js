document.querySelectorAll(".js-lightbox").forEach((button) => {
  button.addEventListener("click", () => {
    const src = button.getAttribute("data-src");
    const name = button.getAttribute("data-name") || "";

    const lightbox = document.getElementById("lightbox");
    const image = document.getElementById("lightbox-image");
    const caption = document.getElementById("lightbox-caption");

    if (!lightbox || !image || !caption) return;

    image.src = src;
    image.alt = name;
    caption.textContent = name;
    lightbox.classList.add("is-open");
    lightbox.setAttribute("aria-hidden", "false");
  });
});

const lightbox = document.getElementById("lightbox");
if (lightbox) {
  lightbox.addEventListener("click", (event) => {
    if (event.target.hasAttribute("data-close")) {
      lightbox.classList.remove("is-open");
      lightbox.setAttribute("aria-hidden", "true");
    }
  });
}
