"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type SignupState = "idle" | "submitting" | "success" | "error";

export function SignupForm() {
  const [state, setState] = useState<SignupState>("idle");
  const [message, setMessage] = useState(
    "Join the editor waitlist. The open-source SDK is available now on GitHub and npm.",
  );

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const form = event.currentTarget;
    const formData = new FormData(form);
    const email = String(formData.get("email") ?? "").trim();
    const website = String(formData.get("website") ?? "");

    setState("submitting");
    setMessage("Joining the waitlist...");

    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ email, website }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as
          | { message?: string }
          | null;
        throw new Error(body?.message ?? "Unable to join right now.");
      }

      form.reset();
      setState("success");
      setMessage("You're on the editor waitlist.");
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Unable to join right now.");
    }
  }

  return (
    <form aria-label="Join the mcut editor waitlist" className="max-w-md" onSubmit={onSubmit}>
      <div className="hidden" aria-hidden="true">
        <label htmlFor="signup-website">Website</label>
        <input
          id="signup-website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="sr-only" htmlFor="signup-email">
          Email address
        </label>
        <Input
          id="signup-email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          className="h-9 bg-background"
          disabled={state === "submitting"}
          required
        />
        <Button type="submit" size="lg" className="h-9 sm:w-auto" disabled={state === "submitting"}>
          {state === "submitting" ? "Joining..." : "Join editor waitlist"}
        </Button>
      </div>
      <p
        className="mt-2 text-xs leading-relaxed text-muted-foreground"
        role={state === "error" ? "alert" : "status"}
      >
        {message}
      </p>
    </form>
  );
}
