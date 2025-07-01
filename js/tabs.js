// Tab switching functionality
export function initializeTabs() {
  const buttons = document.querySelectorAll(".tab-btn");
  const panes = document.querySelectorAll(".tab-pane");

  // Initial state check
  const activeTab = document.querySelector(".tab-btn.active");
  if (activeTab) {
    const targetPane = document.getElementById(activeTab.dataset.target);
    if (targetPane) {
      targetPane.classList.add("active");
    }
  }

  buttons.forEach(btn => {
    btn.addEventListener("click", () => {
      // Remove active class from all buttons and add to clicked button
      buttons.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      
      // Hide all panes and show the target pane
      panes.forEach(pane => pane.classList.remove("active"));
      const targetPane = document.getElementById(btn.dataset.target);
      if (targetPane) {
        targetPane.classList.add("active");
      }
    });
  });
} 