import { redirect } from "next/navigation";

// The app's entry point is the home screen; the manifest's start_url is "/" so
// this is what a launch from the home screen hits. Unauthenticated visitors are
// sent to /login by the middleware.
export default function Index() {
  redirect("/home");
}
