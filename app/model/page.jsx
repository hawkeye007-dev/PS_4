import ModelStatus from "../../components/ModelStatus";

export const metadata = {
  title: "Campus Load | Forecast Model",
  description: "Live model architecture and evaluation status for campus load forecasting.",
};

export default function ModelPage() {
  return <ModelStatus />;
}
