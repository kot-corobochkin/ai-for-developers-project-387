import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addDays, format, parseISO } from "date-fns";
import { CalendarDays, ChevronRight, Clock3, Mail, MapPin, Plus, Settings2, Trash2, UserRound } from "lucide-react";
import { api, ApiRequestError, getApiError } from "./api/client";
import type { BookingStatus, CreateAvailabilityExceptionRequest, EventType } from "./api/types";
import { Badge, Button, Card, EmptyState, Input, Spinner } from "./components/ui";
import { dateInputValue, formatDate, formatDateTime, isPastDate, nextDaysRange, toRfc3339 } from "./utils";

type View = "public" | "admin";
type AdminTab = "events" | "bookings" | "exceptions";

function Loading() { return <div className="loading"><Spinner /> Загрузка…</div>; }
function ErrorBox({ error }: { error: unknown }) { return <div className="error-box">{getApiError(error)}</div>; }

function Header({ view, onNavigate }: { view: View; onNavigate: (view: View) => void }) {
  return <header className="topbar"><div className="container topbar-inner">
    <button className="brand" onClick={() => onNavigate("public")}><span className="brand-mark"><CalendarDays size={19} /></span><span>Calendar</span></button>
    <nav className="nav"><button className={view === "public" ? "nav-link active" : "nav-link"} onClick={() => onNavigate("public")}>Записаться</button><button className={view === "admin" ? "nav-link active" : "nav-link"} onClick={() => onNavigate("admin")}><Settings2 size={16} /> Управление</button></nav>
  </div></header>;
}

function PublicPage() {
  const client = useQueryClient();
  const owner = useQuery({ queryKey: ["public-owner"], queryFn: api.public.owner });
  const eventTypes = useQuery({ queryKey: ["public-event-types"], queryFn: api.public.eventTypes });
  const [selected, setSelected] = useState<EventType | null>(null);
  const [date, setDate] = useState(dateInputValue(new Date()));
  const [slot, setSlot] = useState<string | null>(null);
  const [booking, setBooking] = useState<{ name: string; email: string }>({ name: "", email: "" });
  const [confirmed, setConfirmed] = useState<{ title: string; startsAt: string; endsAt: string } | null>(null);
  const range = useMemo(nextDaysRange, []);
  const slots = useQuery({ queryKey: ["slots", selected?.id, date], queryFn: () => api.public.slots(selected!.id, date, date), enabled: Boolean(selected) });
  const createBooking = useMutation({ mutationFn: api.public.createBooking, onSuccess: (result) => { client.invalidateQueries({ queryKey: ["slots"] }); setConfirmed({ title: result.eventTypeTitle, startsAt: result.startsAt, endsAt: result.endsAt }); setSlot(null); }, onError: (error) => { const code = error instanceof ApiRequestError ? error.payload?.code : undefined; if (code === "BOOKING_CONFLICT" || code === "SLOT_UNAVAILABLE") { client.invalidateQueries({ queryKey: ["slots"] }); setSlot(null); } } });
  const days = Array.from({ length: 14 }, (_, index) => addDays(parseISO(`${range.from}T12:00:00`), index));

  if (owner.isLoading || eventTypes.isLoading) return <Loading />;
  if (owner.error) return <ErrorBox error={owner.error} />;
  if (eventTypes.error) return <ErrorBox error={eventTypes.error} />;
  if (confirmed) return <div className="container narrow"><Card className="success-card"><div className="success-icon">✓</div><p className="eyebrow">Встреча подтверждена</p><h1>{confirmed.title}</h1><p className="lead">Мы сохранили вашу встречу.</p><div className="confirmation-row"><CalendarDays size={19} /><span>{formatDateTime(confirmed.startsAt, owner.data?.timezone)}</span></div><div className="confirmation-row"><Clock3 size={19} /><span>{Math.round((new Date(confirmed.endsAt).getTime() - new Date(confirmed.startsAt).getTime()) / 60000)} минут</span></div><Button className="wide" onClick={() => { setConfirmed(null); setSelected(null); }}>Создать ещё одну встречу</Button></Card></div>;

  return <div className="container public-layout">
    <section className="hero"><div className="eyebrow">Онлайн-календарь</div><h1>Запланируйте время<br /><span>для важного разговора.</span></h1><p className="lead">Выберите удобный формат встречи и свободное время. Подтверждение займёт меньше минуты.</p><div className="owner-line"><span className="avatar">{owner.data?.fullName.charAt(0)}</span><span><strong>{owner.data?.fullName}</strong><small>{owner.data?.email}</small></span></div></section>
    {!selected ? <section><div className="section-heading"><div><p className="eyebrow">Доступные встречи</p><h2>Выберите формат</h2></div></div><div className="event-grid">{eventTypes.data?.map((event) => <button className="event-card" key={event.id} onClick={() => setSelected(event)}><div className="event-card-icon"><Clock3 size={20} /></div><div><h3>{event.title}</h3><p>{event.description || "Личная встреча с владельцем календаря."}</p><span className="event-duration">{event.durationMinutes} минут <ChevronRight size={15} /></span></div></button>)}</div>{!eventTypes.data?.length && <EmptyState>Сейчас нет доступных типов встреч.</EmptyState>}</section> : <BookingFlow event={selected} days={days} date={date} setDate={setDate} slot={slot} setSlot={setSlot} slots={slots} booking={booking} setBooking={setBooking} createBooking={createBooking} ownerTimezone={owner.data?.timezone} onBack={() => { setSelected(null); setSlot(null); }} />}
  </div>;
}

function BookingFlow({ event, days, date, setDate, slot, setSlot, slots, booking, setBooking, createBooking, ownerTimezone, onBack }: any) {
  return <section className="booking-flow"><button className="back-link" onClick={onBack}>← Все форматы</button><div className="flow-header"><div><p className="eyebrow">Выбранная встреча</p><h2>{event.title}</h2><p>{event.description}</p></div><Badge tone="success"><Clock3 size={14} /> {event.durationMinutes} минут</Badge></div><div className="booking-grid"><Card><div className="card-title"><CalendarDays size={18} /><h3>Выберите дату</h3></div><div className="days-grid">{days.map((day: Date) => { const value = dateInputValue(day); return <button key={value} className={date === value ? "day active" : "day"} disabled={isPastDate(value)} onClick={() => { setDate(value); setSlot(null); }}><small>{format(day, "EEE")}</small><strong>{format(day, "d")}</strong></button>; })}</div><div className="slots-heading"><h3>Свободное время</h3><span>{formatDate(date)}</span></div>{slots.isLoading && <Loading />}{slots.error && <ErrorBox error={slots.error} />}{!slots.isLoading && !slots.data?.length && <EmptyState>На эту дату свободного времени нет.</EmptyState>}<div className="slots-grid">{slots.data?.map((item: any) => <button key={item.startsAt} className={slot === item.startsAt ? "slot active" : "slot"} onClick={() => setSlot(item.startsAt)}>{formatDateTime(item.startsAt, ownerTimezone).split(", ").pop()} – {formatDateTime(item.endsAt, ownerTimezone).split(", ").pop()}</button>)}</div></Card><Card className="guest-card"><div className="card-title"><UserRound size={18} /><h3>Ваши данные</h3></div><p className="muted">Они нужны только для подтверждения встречи.</p><label>Имя и фамилия<Input value={booking.name} onChange={(event) => setBooking({ ...booking, name: event.target.value })} placeholder="Например, Анна Петрова" /></label><label>Email<Input type="email" value={booking.email} onChange={(event) => setBooking({ ...booking, email: event.target.value })} placeholder="you@example.com" /></label>{createBooking.error && <ErrorBox error={createBooking.error} />}<Button className="wide" disabled={!slot || !booking.name.trim() || !booking.email.includes("@") || createBooking.isPending} onClick={() => createBooking.mutate({ eventTypeId: event.id, startsAt: slot, guestName: booking.name.trim(), guestEmail: booking.email.trim() })}>{createBooking.isPending ? <Spinner /> : "Подтвердить встречу"}</Button></Card></div></section>;
}

function AdminPage() {
  const [tab, setTab] = useState<AdminTab>("events");
  return <div className="container admin-layout"><div className="page-heading"><div><p className="eyebrow">Рабочее место владельца</p><h1>Управление календарём</h1><p className="lead">Настройте встречи, следите за бронированиями и закрывайте время.</p></div><div className="admin-badge">Администратор</div></div><div className="tabs">{([["events", "Типы встреч"], ["bookings", "Бронирования"], ["exceptions", "Недоступность"]] as [AdminTab, string][]).map(([key, label]) => <button className={tab === key ? "tab active" : "tab"} key={key} onClick={() => setTab(key)}>{label}</button>)}</div>{tab === "events" && <EventTypesAdmin />}{tab === "bookings" && <BookingsAdmin />}{tab === "exceptions" && <ExceptionsAdmin />}</div>;
}

function EventTypesAdmin() {
  const client = useQueryClient(); const [editing, setEditing] = useState<EventType | null>(null); const [creating, setCreating] = useState(false);
  const query = useQuery({ queryKey: ["admin-event-types"], queryFn: api.admin.eventTypes });
  const save = useMutation({ mutationFn: (payload: { id?: string; title: string; description?: string; durationMinutes: number }) => { const { id, ...body } = payload; return id ? api.admin.updateEventType(id, body) : api.admin.createEventType(body); }, onSuccess: () => { client.invalidateQueries({ queryKey: ["admin-event-types"] }); setEditing(null); setCreating(false); } });
  const deactivate = useMutation({ mutationFn: api.admin.deleteEventType, onSuccess: () => client.invalidateQueries({ queryKey: ["admin-event-types"] }) });
  return <section><div className="toolbar"><div><p className="eyebrow">Каталог</p><h2>Типы встреч</h2></div><Button onClick={() => setCreating(true)}><Plus size={17} /> Новый тип</Button></div>{query.isLoading && <Loading />}{query.error && <ErrorBox error={query.error} />}<div className="admin-table">{query.data?.map((event) => <div className="table-row" key={event.id}><div className="row-main"><div className="event-card-icon small"><Clock3 size={17} /></div><div><strong>{event.title}</strong><small>{event.description || "Без описания"}</small></div></div><span>{event.durationMinutes} мин</span><Badge tone={event.isActive ? "success" : "neutral"}>{event.isActive ? "Активен" : "Отключён"}</Badge><div className="row-actions"><Button variant="ghost" onClick={() => setEditing(event)}>Изменить</Button>{event.isActive && <Button variant="danger" onClick={() => { if (window.confirm("Отключить этот тип встречи?")) deactivate.mutate(event.id); }}><Trash2 size={15} /></Button>}</div></div>)}</div>{!query.data?.length && !query.isLoading && <EmptyState>Типы встреч ещё не созданы.</EmptyState>}{(creating || editing) && <EventTypeModal event={editing} pending={save.isPending} error={save.error} onClose={() => { setEditing(null); setCreating(false); }} onSave={(payload) => save.mutate(payload)} />}</section>;
}

function EventTypeModal({ event, pending, error, onClose, onSave }: { event: EventType | null; pending: boolean; error: unknown; onClose: () => void; onSave: (payload: any) => void }) {
  const [title, setTitle] = useState(event?.title || ""); const [description, setDescription] = useState(event?.description || ""); const [duration, setDuration] = useState(String(event?.durationMinutes || 30));
  return <div className="modal-backdrop"><div className="modal"><div className="modal-heading"><div><p className="eyebrow">{event ? "Редактирование" : "Новый тип"}</p><h2>{event ? "Изменить встречу" : "Создать встречу"}</h2></div><button className="close" onClick={onClose}>×</button></div><label>Название<Input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus /></label><label>Описание<textarea className="textarea" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="Что обсудите на встрече?" /></label><label>Продолжительность, минут<Input type="number" min="1" value={duration} onChange={(e) => setDuration(e.target.value)} /></label>{Boolean(error) && <ErrorBox error={error} />}<div className="modal-actions"><Button variant="ghost" onClick={onClose}>Отмена</Button><Button disabled={!title.trim() || Number(duration) <= 0 || pending} onClick={() => onSave({ ...(event ? { id: event.id } : {}), title: title.trim(), description: description.trim() || undefined, durationMinutes: Number(duration) })}>{pending ? <Spinner /> : "Сохранить"}</Button></div></div></div>;
}

function BookingsAdmin() {
  const range = useMemo(nextDaysRange, []); const [status, setStatus] = useState<BookingStatus | "">("");
  const owner = useQuery({ queryKey: ["admin-owner"], queryFn: api.public.owner });
  const query = useQuery({ queryKey: ["admin-bookings", range, status], queryFn: () => api.admin.bookings(range.from, range.to, status || undefined) });
  return <section><div className="toolbar"><div><p className="eyebrow">Расписание</p><h2>Ближайшие бронирования</h2></div><select className="select" value={status} onChange={(e) => setStatus(e.target.value as BookingStatus | "")}><option value="">Все статусы</option><option value="confirmed">Подтверждённые</option><option value="cancelled">Отменённые</option></select></div>{(query.isLoading || owner.isLoading) && <Loading />}{query.error && <ErrorBox error={query.error} />}{owner.error && <ErrorBox error={owner.error} />}<div className="admin-table">{query.data?.map((booking) => <div className="table-row booking-row" key={booking.id}><div className="row-main"><div className="date-tile"><strong>{format(parseISO(booking.startsAt), "d")}</strong><small>{format(parseISO(booking.startsAt), "MMM")}</small></div><div><strong>{booking.eventTypeTitle}</strong><small>{booking.guestName} · {booking.guestEmail}</small></div></div><span>{formatDateTime(booking.startsAt, owner.data?.timezone)} – {formatDateTime(booking.endsAt, owner.data?.timezone).split(", ").pop()}</span><Badge tone={booking.status === "confirmed" ? "success" : "neutral"}>{booking.status === "confirmed" ? "Подтверждено" : "Отменено"}</Badge></div>)}</div>{!query.data?.length && !query.isLoading && <EmptyState>Ближайших бронирований нет.</EmptyState>}</section>;
}

function ExceptionsAdmin() {
  const client = useQueryClient(); const range = useMemo(nextDaysRange, []); const [form, setForm] = useState<CreateAvailabilityExceptionRequest>({ startsAt: "", endsAt: "", reason: "" });
  const query = useQuery({ queryKey: ["admin-exceptions", range], queryFn: () => api.admin.exceptions(range.from, range.to) });
  const create = useMutation({ mutationFn: api.admin.createException, onSuccess: () => { client.invalidateQueries({ queryKey: ["admin-exceptions"] }); setForm({ startsAt: "", endsAt: "", reason: "" }); } });
  const remove = useMutation({ mutationFn: api.admin.deleteException, onSuccess: () => client.invalidateQueries({ queryKey: ["admin-exceptions"] }) });
  return <section><div className="toolbar"><div><p className="eyebrow">Время владельца</p><h2>Недоступность</h2></div></div><Card className="exception-form"><div className="form-grid"><label>Начало<input className="input" type="datetime-local" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} /></label><label>Конец<input className="input" type="datetime-local" value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} /></label><label>Причина (необязательно)<Input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Например, отпуск" /></label><Button disabled={!form.startsAt || !form.endsAt || create.isPending} onClick={() => create.mutate({ startsAt: new Date(form.startsAt).toISOString(), endsAt: new Date(form.endsAt).toISOString(), reason: form.reason || undefined })}>{create.isPending ? <Spinner /> : <><Plus size={17} /> Закрыть время</>}</Button></div>{create.error && <ErrorBox error={create.error} />}</Card>{query.isLoading && <Loading />}{query.error && <ErrorBox error={query.error} />}<div className="admin-table">{query.data?.map((item) => <div className="table-row" key={item.id}><div className="row-main"><div className="event-card-icon small"><MapPin size={17} /></div><div><strong>{formatDateTime(item.startsAt)} – {formatDateTime(item.endsAt).split(", ").pop()}</strong><small>{item.reason || "Без причины"}</small></div></div><Button variant="danger" onClick={() => remove.mutate(item.id)}><Trash2 size={15} /> Удалить</Button></div>)}</div>{!query.data?.length && !query.isLoading && <EmptyState>Закрытых интервалов нет.</EmptyState>}</section>;
}

export default function App() {
  const [view, setView] = useState<View>(window.location.hash === "#/admin" ? "admin" : "public");
  const navigate = (next: View) => { window.location.hash = next === "admin" ? "/admin" : "/"; setView(next); };
  return <><Header view={view} onNavigate={navigate} /><main>{view === "admin" ? <AdminPage /> : <PublicPage />}</main><footer><div className="container"><span>Calendar Service</span><span>Рабочее время в часовом поясе владельца</span></div></footer></>;
}
