export const metadata = {
  title: "SENTINEL API",
  description:
    "Surfaces elevated welfare-risk indicators for human review. Not a clinical diagnosis.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
