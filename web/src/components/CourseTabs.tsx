"use client";

import { cn } from "@/lib/cn";

export function CourseTabs({
  courses,
  activeCourseId,
  onSelect,
}: {
  courses: { id: string; title: string }[];
  activeCourseId: string | null;
  onSelect: (courseId: string) => void;
}) {
  return (
    <div className="flex gap-1 overflow-x-auto">
      {courses.map((course) => {
        const active = course.id === activeCourseId;
        return (
          <button
            key={course.id}
            onClick={() => onSelect(course.id)}
            aria-current={active}
            className={cn(
              "whitespace-nowrap rounded-t-md border border-b-0 px-4 py-2 font-display text-sm transition-colors",
              active
                ? "border-rule bg-surface text-ink"
                : "border-transparent bg-transparent text-ink-soft hover:bg-surface/60",
            )}
          >
            {course.title}
          </button>
        );
      })}
    </div>
  );
}
