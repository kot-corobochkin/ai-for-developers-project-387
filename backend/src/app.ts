import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import cors from "@fastify/cors";
import { DateTime } from "luxon";
import { CalendarStore, WORK_END, WORK_START, dateRangeWithinWindow, isSlotBoundary, iso, nowInOwnerZone, overlaps, parseDate, parseInstant, withinBookingWindow, windowBounds } from "./store.js";
import type { ApiError, AvailabilityException, Booking, CreateAvailabilityExceptionRequest, CreateBookingRequest, CreateEventTypeRequest, EventType, UpdateEventTypeRequest } from "./types.js";

export function createApp(store = new CalendarStore()): FastifyInstance {
  const app = Fastify({ logger: false });
  app.register(cors, { origin: true });

  const fail = (reply: FastifyReply, status: number, code: ApiError["code"], message: string, field?: string) =>
    reply.code(status).send({ code, message, ...(field ? { field } : {}) });
  const body = (request: { body: unknown }) => request.body as Record<string, unknown> | null;
  const pathId = (request: { params: unknown }) => (request.params as { eventTypeId?: string; exceptionId?: string }).eventTypeId;
  const isEmail = (value: unknown) => typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  const validTitle = (value: unknown) => typeof value === "string" && value.trim().length > 0 && value.trim().length <= 200;
  const validDuration = (value: unknown) => typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 24 * 60;

  app.get("/health", async (_request, reply) => reply.send({ status: "ok", service: "calendar-service" }));
  app.get("/", async (_request, reply) => reply.send({ service: "calendar-service", api: "/api", health: "/health" }));
  app.get("/api/public/owner", async (_request, reply) => reply.send({ fullName: store.owner.fullName, email: store.owner.email, timezone: store.owner.timezone }));
  app.get("/api/public/event-types", async (_request, reply) => reply.send(store.eventTypes.filter((event) => event.isActive)));
  app.get<{ Params: { eventTypeId: string } }>("/api/public/event-types/:eventTypeId", async (request, reply) => {
    const event = store.eventTypes.find((item) => item.id === request.params.eventTypeId);
    if (!event) return fail(reply, 404, "EVENT_TYPE_NOT_FOUND", "Тип встречи не найден.");
    if (!event.isActive) return fail(reply, 422, "EVENT_TYPE_INACTIVE", "Тип встречи отключён.");
    return reply.send(event);
  });

  app.get<{ Params: { eventTypeId: string }; Querystring: { from?: string; to?: string } }>("/api/public/event-types/:eventTypeId/slots", async (request, reply) => {
    const event = store.eventTypes.find((item) => item.id === request.params.eventTypeId);
    if (!event) return fail(reply, 404, "EVENT_TYPE_NOT_FOUND", "Тип встречи не найден.");
    if (!event.isActive) return fail(reply, 422, "EVENT_TYPE_INACTIVE", "Тип встречи отключён.");
    const from = parseDate(request.query.from), to = parseDate(request.query.to);
    if (!from || !to || from > to) return fail(reply, 400, "VALIDATION_ERROR", "Неверный диапазон дат.");
    if (!dateRangeWithinWindow(from, to)) return fail(reply, 422, "SLOT_OUTSIDE_BOOKING_WINDOW", "Дата находится за пределами окна бронирования.");
    const slots: { startsAt: string; endsAt: string }[] = [];
    for (let day = from; day <= to; day = day.plus({ days: 1 })) {
      if (day.weekday > 5) continue;
      for (let minute = WORK_START * 60; minute + event.durationMinutes <= WORK_END * 60; minute += event.durationMinutes) {
        const start = day.startOf("day").plus({ minutes: minute });
        if (!isSlotBoundary(start, event.durationMinutes)) continue;
        const end = start.plus({ minutes: event.durationMinutes });
        if (start <= nowInOwnerZone()) continue;
        const unavailable = store.exceptions.some((item) => overlaps(start.toUTC(), end.toUTC(), parseInstant(item.startsAt)!, parseInstant(item.endsAt)!));
        const occupied = store.bookings.some((item) => item.status === "confirmed" && overlaps(start.toUTC(), end.toUTC(), parseInstant(item.startsAt)!, parseInstant(item.endsAt)!));
        if (!unavailable && !occupied) slots.push({ startsAt: iso(start), endsAt: iso(end) });
      }
    }
    return reply.send(slots);
  });

  app.post<{ Body: CreateBookingRequest }>("/api/public/bookings", async (request, reply) => {
    const input = body(request);
    if (!input || typeof input.eventTypeId !== "string" || !parseInstant(input.startsAt) || !validTitle(input.guestName) || !isEmail(input.guestEmail))
      return fail(reply, 400, "VALIDATION_ERROR", "Некорректные данные бронирования.");
    const event = store.eventTypes.find((item) => item.id === input.eventTypeId);
    if (!event) return fail(reply, 404, "EVENT_TYPE_NOT_FOUND", "Тип встречи не найден.");
    if (!event.isActive) return fail(reply, 422, "EVENT_TYPE_INACTIVE", "Тип встречи отключён.");
    const start = parseInstant(input.startsAt)!; const end = start.plus({ minutes: event.durationMinutes });
    if (!withinBookingWindow(start.setZone(store.owner.timezone), end.setZone(store.owner.timezone))) return fail(reply, 422, "SLOT_OUTSIDE_BOOKING_WINDOW", "Дата находится за пределами окна бронирования.");
    const localStart = start.setZone(store.owner.timezone);
    const validWorkingSlot = isSlotBoundary(localStart, event.durationMinutes) && localStart > nowInOwnerZone();
    if (!validWorkingSlot) return fail(reply, 409, "SLOT_UNAVAILABLE", "Выбранное время недоступно.");
    if (store.bookings.some((item) => item.status === "confirmed" && overlaps(start, end, parseInstant(item.startsAt)!, parseInstant(item.endsAt)!))) return fail(reply, 409, "BOOKING_CONFLICT", "Это время уже заняли.");
    if (store.exceptions.some((item) => overlaps(start, end, parseInstant(item.startsAt)!, parseInstant(item.endsAt)!))) return fail(reply, 409, "SLOT_UNAVAILABLE", "Выбранное время недоступно.");
    const booking: Booking = { id: crypto.randomUUID(), eventTypeId: event.id, eventTypeTitle: event.title, guestName: String(input.guestName).trim(), guestEmail: String(input.guestEmail).trim(), startsAt: iso(start), endsAt: iso(end), status: "confirmed", createdAt: new Date().toISOString() };
    store.bookings.push(booking);
    return reply.code(201).send(booking);
  });

  app.get("/api/admin/event-types", async (_request, reply) => reply.send(store.eventTypes));
  app.post<{ Body: CreateEventTypeRequest }>("/api/admin/event-types", async (request, reply) => {
    const input = body(request);
    if (!input || !validTitle(input.title) || !validDuration(input.durationMinutes)) return fail(reply, 422, "VALIDATION_ERROR", "Некорректные параметры типа встречи.");
    const event = store.addEventType({ title: String(input.title).trim(), description: typeof input.description === "string" && input.description.trim() ? input.description.trim() : undefined, durationMinutes: input.durationMinutes as number });
    return reply.code(201).send(event);
  });
  app.get<{ Params: { eventTypeId: string } }>("/api/admin/event-types/:eventTypeId", async (request, reply) => {
    const event = store.eventTypes.find((item) => item.id === request.params.eventTypeId);
    return event ? reply.send(event) : fail(reply, 404, "EVENT_TYPE_NOT_FOUND", "Тип встречи не найден.");
  });
  app.patch<{ Params: { eventTypeId: string }; Body: UpdateEventTypeRequest }>("/api/admin/event-types/:eventTypeId", async (request, reply) => {
    const event = store.eventTypes.find((item) => item.id === request.params.eventTypeId); const input = body(request);
    if (!event) return fail(reply, 404, "EVENT_TYPE_NOT_FOUND", "Тип встречи не найден.");
    if (!input || (input.title !== undefined && !validTitle(input.title)) || (input.durationMinutes !== undefined && !validDuration(input.durationMinutes))) return fail(reply, 422, "VALIDATION_ERROR", "Некорректные параметры типа встречи.");
    if (input.title !== undefined) event.title = String(input.title).trim();
    if (input.description !== undefined) event.description = typeof input.description === "string" && input.description.trim() ? input.description.trim() : undefined;
    if (input.durationMinutes !== undefined) event.durationMinutes = input.durationMinutes as number;
    if (input.isActive !== undefined) event.isActive = Boolean(input.isActive);
    event.updatedAt = new Date().toISOString();
    return reply.send(event);
  });
  app.delete<{ Params: { eventTypeId: string } }>("/api/admin/event-types/:eventTypeId", async (request, reply) => {
    const event = store.eventTypes.find((item) => item.id === request.params.eventTypeId);
    if (!event) return fail(reply, 404, "EVENT_TYPE_NOT_FOUND", "Тип встречи не найден.");
    event.isActive = false; event.updatedAt = new Date().toISOString();
    return reply.code(204).send();
  });

  app.get<{ Querystring: { from?: string; to?: string; status?: string } }>("/api/admin/bookings", async (request, reply) => {
    const from = request.query.from ? parseDate(request.query.from) : null; const to = request.query.to ? parseDate(request.query.to) : null;
    if ((request.query.from && !from) || (request.query.to && !to) || (from && to && from > to) || (request.query.status && !["confirmed", "cancelled"].includes(request.query.status))) return fail(reply, 400, "VALIDATION_ERROR", "Некорректные параметры фильтра.");
    const lower = from?.toUTC(); const upper = to?.endOf("day").toUTC();
    const result = store.bookings.filter((item) => { const start = parseInstant(item.startsAt)!; return (!lower || start >= lower) && (!upper || start <= upper) && (!request.query.status || item.status === request.query.status); }).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    return reply.send(result);
  });

  app.post<{ Body: CreateAvailabilityExceptionRequest }>("/api/admin/availability-exceptions", async (request, reply) => {
    const input = body(request); const start = parseInstant(input?.startsAt); const end = parseInstant(input?.endsAt);
    if (!start || !end || start >= end) return fail(reply, 422, "VALIDATION_ERROR", "Некорректный интервал недоступности.");
    if (store.bookings.some((item) => item.status === "confirmed" && overlaps(start, end, parseInstant(item.startsAt)!, parseInstant(item.endsAt)!))) return fail(reply, 409, "AVAILABILITY_EXCEPTION_CONFLICT", "Интервал пересекается с бронированием.");
    const exception: AvailabilityException = { id: crypto.randomUUID(), startsAt: iso(start), endsAt: iso(end), reason: typeof input?.reason === "string" && input.reason.trim() ? input.reason.trim() : undefined, createdAt: new Date().toISOString() };
    store.exceptions.push(exception); return reply.code(201).send(exception);
  });
  app.get<{ Querystring: { from?: string; to?: string } }>("/api/admin/availability-exceptions", async (request, reply) => {
    const from = parseDate(request.query.from), to = parseDate(request.query.to);
    if (!from || !to || from > to) return fail(reply, 400, "VALIDATION_ERROR", "Неверный диапазон дат.");
    const lower = from.toUTC(), upper = to.endOf("day").toUTC();
    return reply.send(store.exceptions.filter((item) => overlaps(parseInstant(item.startsAt)!, parseInstant(item.endsAt)!, lower, upper)));
  });
  app.delete<{ Params: { exceptionId: string } }>("/api/admin/availability-exceptions/:exceptionId", async (request, reply) => {
    const index = store.exceptions.findIndex((item) => item.id === request.params.exceptionId);
    if (index < 0) return fail(reply, 404, "VALIDATION_ERROR", "Интервал недоступности не найден.");
    store.exceptions.splice(index, 1); return reply.code(204).send();
  });

  app.setErrorHandler((error, _request, reply) => {
    if ((error as { code?: string }).code === "FST_ERR_CTP_INVALID_JSON_BODY") return fail(reply, 400, "VALIDATION_ERROR", "Некорректный JSON.");
    return reply.code(500).send({ code: "VALIDATION_ERROR", message: "Внутренняя ошибка сервера." });
  });
  return app;
}
