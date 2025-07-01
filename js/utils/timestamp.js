/**
 * Returns a formatted timestamp string, e.g., "[Sent at 10:45:27 AM]".
 * @returns {string} The formatted timestamp.
 */
function getTimestamp() {
  const now = new Date();
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const seconds = now.getSeconds();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const formattedHours = hours % 12 || 12; // The hour '0' should be '12'
  const formattedMinutes = minutes < 10 ? '0' + minutes : minutes;
  const formattedSeconds = seconds < 10 ? '0' + seconds : seconds;

  // Add newlines to create a footer effect at the end of the message.
  return `\n\n[Sent at ${formattedHours}:${formattedMinutes}:${formattedSeconds} ${ampm}]`;
}
