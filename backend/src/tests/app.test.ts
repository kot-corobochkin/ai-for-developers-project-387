import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../app.js";
import { CalendarStore } from "../store.js";

async function appWithStore() {
  const app = createApp(new CalendarStore());
  await app.ready();
  return app;
}

test("serves the seeded owner and event types", async () => {
  const app = await appWithStore();
  const owner = await app.inject({ method: "GET", url: "/api/public/owner" });
  const events = await app.inject({ method: "GET", url: "/api/public/event-types" });
  assert.equal(owner.statusCode, 200);
  assert.equal(JSON.parse(owner.body).timezone, "Europe/Moscow");
  assert.equal(JSON.parse(events.body).length, 2);
  await app.close();
});

test("creates a booking and rejects the same slot with BOOKING_CONFLICT", async () => {
  const app = await appWithStore();
  const events = JSON.parse((await app.inject({ method: "GET", url: "/api/public/event-types" })).body) as { id: string }[];
  const outsideWindow = await app.inject({ method: "GET", url: `/api/public/event-types/${events[0].id}/slots?from=2099-01-01&to=2099-01-01` });
  assert.equal(outsideWindow.statusCode, 422);

  const today = new Date();
  const date = today.toISOString().slice(0, 10);
  const end = new Date(today.getTime() + 13 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const available = JSON.parse((await app.inject({ method: "GET", url: `/api/public/event-types/${events[0].id}/slots?from=${date}&to=${end}` })).body) as { startsAt: string }[];
  if (!available.length) return app.close();
  const payload = { eventTypeId: events[0].id, startsAt: available[0].startsAt, guestName: "Иван Иванов", guestEmail: "ivan@example.com" };
  const first = await app.inject({ method: "POST", url: "/api/public/bookings", payload });
  const second = await app.inject({ method: "POST", url: "/api/public/bookings", payload });
  assert.equal(first.statusCode, 201);
  assert.equal(second.statusCode, 409);
  assert.equal(JSON.parse(second.body).code, "BOOKING_CONFLICT");
  await app.close();
});

test("deactivates an event type without deleting it", async () => {
  const app = await appWithStore();
  const event = JSON.parse((await app.inject({ method: "GET", url: "/api/admin/event-types" })).body)[0] as { id: string };
  const response = await app.inject({ method: "DELETE", url: `/api/admin/event-types/${event.id}` });
  const publicEvents = await app.inject({ method: "GET", url: "/api/public/event-types" });
  const adminEvents = await app.inject({ method: "GET", url: "/api/admin/event-types" });
  assert.equal(response.statusCode, 204);
  assert.equal(JSON.parse(publicEvents.body).some((item: { id: string }) => item.id === event.id), false);
  assert.equal(JSON.parse(adminEvents.body).some((item: { id: string; isActive: boolean }) => item.id === event.id && !item.isActive), true);
  await app.close();
});

test("rejects an unavailable slot and prevents closing booked time", async () => {
  const app = await appWithStore();
  const event = JSON.parse((await app.inject({ method: "GET", url: "/api/public/event-types" })).body)[0] as { id: string };
  const date = new Date().toISOString().slice(0, 10);
  const endDate = new Date(Date.now() + 13 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const slots = JSON.parse((await app.inject({ method: "GET", url: `/api/public/event-types/${event.id}/slots?from=${date}&to=${endDate}` })).body) as { startsAt: string; endsAt: string }[];
  if (!slots.length) return app.close();
  const close = await app.inject({ method: "POST", url: "/api/admin/availability-exceptions", payload: { startsAt: slots[0].startsAt, endsAt: slots[0].endsAt, reason: "Перерыв" } });
  assert.equal(close.statusCode, 201);
  const unavailable = await app.inject({ method: "POST", url: "/api/public/bookings", payload: { eventTypeId: event.id, startsAt: slots[0].startsAt, guestName: "Иван Иванов", guestEmail: "ivan@example.com" } });
  assert.equal(unavailable.statusCode, 409);
  assert.equal(JSON.parse(unavailable.body).code, "SLOT_UNAVAILABLE");
  await app.close();
});

test("books every generated slot for a duration that does not divide 60", async () => {
  const app = await appWithStore();
  const event = JSON.parse((await app.inject({ method: "POST", url: "/api/admin/event-types", payload: { title: "Глубокая консультация", durationMinutes: 45 } })).body) as { id: string };
  const date = new Date().toISOString().slice(0, 10);
  const endDate = new Date(Date.now() + 13 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const slots = JSON.parse((await app.inject({ method: "GET", url: `/api/public/event-types/${event.id}/slots?from=${date}&to=${endDate}` })).body) as { startsAt: string }[];
  assert.ok(slots.length > 0);
  for (const slot of slots.slice(0, 5)) {
    const response = await app.inject({ method: "POST", url: "/api/public/bookings", payload: { eventTypeId: event.id, startsAt: slot.startsAt, guestName: "Иван Иванов", guestEmail: "ivan@example.com" } });
    assert.equal(response.statusCode, 201, `slot ${slot.startsAt} should be bookable`);
  }
  await app.close();
});

test("does not allow an availability exception over a booking", async () => {
  const app = await appWithStore();
  const event = JSON.parse((await app.inject({ method: "GET", url: "/api/public/event-types" })).body)[0] as { id: string };
  const date = new Date().toISOString().slice(0, 10);
  const endDate = new Date(Date.now() + 13 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const slots = JSON.parse((await app.inject({ method: "GET", url: `/api/public/event-types/${event.id}/slots?from=${date}&to=${endDate}` })).body) as { startsAt: string; endsAt: string }[];
  if (!slots.length) return app.close();
  const booking = await app.inject({ method: "POST", url: "/api/public/bookings", payload: { eventTypeId: event.id, startsAt: slots[0].startsAt, guestName: "Иван Иванов", guestEmail: "ivan@example.com" } });
  assert.equal(booking.statusCode, 201);
  const close = await app.inject({ method: "POST", url: "/api/admin/availability-exceptions", payload: { startsAt: slots[0].startsAt, endsAt: slots[0].endsAt } });
  assert.equal(close.statusCode, 409);
  assert.equal(JSON.parse(close.body).code, "AVAILABILITY_EXCEPTION_CONFLICT");
  await app.close();
});
