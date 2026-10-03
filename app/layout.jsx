import "./styles.css";
import "./redesign.css";
import "./building-colors.css";
import "./model-status.css";
import "./analysis.css";
import "./scenario.css";

export const metadata = {
  title: "Campus Load | Room Planning",
  description: "Estimated room-wise schedule and campus load simulation.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
