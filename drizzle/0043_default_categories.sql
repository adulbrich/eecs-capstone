ALTER TABLE "categories" ADD COLUMN "description" text;--> statement-breakpoint

-- The default project categories (#31), copied from
-- src/lib/default-categories.ts; default-categories-parity.test.ts pins these
-- rows to that list. Every row is ('type', 'name', 'description').
--
-- ON CONFLICT DO NOTHING, so a category staff already keep under the same
-- type and name stays as it is. The target spells the expressions of
-- categories_domain_type_name_unique_idx, because ON CONSTRAINT takes a
-- constraint and that index is not one.
INSERT INTO "categories" ("domain", "type", "name", "description")
SELECT 'project'::"category_domain", v."type", v."name", v."description"
FROM (VALUES
  ('Field', 'Web Development', 'Web applications, sites and portals, and the back-end services and APIs a browser consumes.'),
  ('Field', 'Game Development', 'Video games and game mechanics, including gamified experiences built as games.'),
  ('Field', 'Mobile Apps', 'Native or cross-platform apps for phones and tablets.'),
  ('Field', 'Machine Learning', 'Training, evaluating or applying learned models, such as classifiers, predictors, reinforcement learning, or the evaluation and fine-tuning of language models.'),
  ('Field', 'Embedded Systems', 'Firmware and software running on microcontrollers or single-board computers, including IoT devices.'),
  ('Field', 'Computer Vision', 'Understanding images or video, such as detection, tracking, pose estimation or 3D reconstruction from cameras.'),
  ('Field', 'Data & Visualization', 'Data pipelines, databases, analytics and dashboards, where the data work is the substance of the project.'),
  ('Field', 'Robotics & Controls', 'Robots, drones, rovers and autonomous vehicles, and the feedback control systems that drive them, from perception to actuation.'),
  ('Field', 'Geospatial & Mapping', 'Maps, GIS, satellite or aerial imagery and other location data, where position on the earth is central to the work.'),
  ('Field', 'Circuit & PCB Design', 'Designing analog or mixed-signal circuits and printed circuit boards.'),
  ('Field', 'Signal Processing', 'Processing audio, acoustic, sonar, radio or sensor signals, digitally or in analog hardware.'),
  ('Field', 'UX Design', 'User research, interaction design, prototyping and usability testing, where the design of how people use the product is a main deliverable.'),
  ('Field', 'Graphics & Simulation', 'Rendering, real-time graphics, and software that simulates physics or a process.'),
  ('Field', 'AR / VR', 'Virtual, augmented or mixed reality experiences and headset software.'),
  ('Field', 'Cybersecurity', 'Security analysis, malware, cryptography, secure storage and vulnerability research.'),
  ('Field', 'Systems Software', 'Operating systems, compilers, programming languages, emulators, runtimes and virtualization.'),
  ('Field', 'Communications & RF', 'Wireless links, radios, antennas, telemetry, GNSS and satellite data links.'),
  ('Field', 'Mechanical Design', 'Designing the physical parts of a device, such as enclosures, mechanisms and structures, through CAD and fabrication.'),
  ('Field', 'Cloud & DevOps', 'Cloud infrastructure, deployment, containers, CI/CD and scaling services.'),
  ('Field', 'Developer Tools', 'Tools for programmers, such as code assistants, IDE features, testing, and code analysis or migration.'),
  ('Field', 'Power Electronics', 'Power conversion, battery charging and management, motor drives and grid-tied electronics.'),
  ('Field', 'Sensors & Instrumentation', 'Measurement hardware: designing sensors, detectors, analyzers and test instruments.'),
  ('Field', 'Devices & Materials', 'Semiconductor devices, fabrication processes, electronic materials and coatings.'),
  ('Field', 'Digital Design & FPGA', 'Digital logic in HDL for FPGAs or ASICs, VLSI design, and chip-design tooling.'),
  ('Technology', 'Python', 'The Python language, for scripting, data work, machine learning or back ends.'),
  ('Technology', 'LLMs', 'Building on large language models or agents, such as OpenAI, Claude, Gemini or Llama models, or retrieval-augmented generation.'),
  ('Technology', 'JavaScript / TypeScript', 'JavaScript or TypeScript, in the browser or on Node.js.'),
  ('Technology', 'C / C++', 'The C or C++ language, for systems, embedded or performance-critical code.'),
  ('Technology', 'SQL', 'Relational databases, such as PostgreSQL, MySQL, SQLite or SQL Server.'),
  ('Technology', 'Flutter / React Native', 'The cross-platform mobile frameworks Flutter or React Native.'),
  ('Technology', 'Unity', 'The Unity game engine.'),
  ('Technology', 'React', 'The React library, for web front ends.'),
  ('Technology', 'Angular', 'The Angular framework, for web front ends.'),
  ('Technology', 'PyTorch / TensorFlow', 'The deep learning frameworks PyTorch or TensorFlow.'),
  ('Technology', 'ROS', 'The Robot Operating System, ROS or ROS 2.'),
  ('Technology', 'AWS', 'Amazon Web Services, as the platform the project is built or deployed on.'),
  ('Technology', 'C#', 'The C# language, including .NET applications.'),
  ('Technology', 'Godot', 'The Godot game engine.'),
  ('Industry', 'Education', 'Teaching and learning tools for any level, from K-12 to university and professional training.'),
  ('Industry', 'Media & Entertainment', 'Film, music, broadcast, media monitoring and entertainment venues.'),
  ('Industry', 'Environment & Sustainability', 'Ecology, wildlife, water, climate, conservation and waste.'),
  ('Industry', 'Healthcare', 'Medicine, nursing, pharmacy, mental health and clinical care, and education in them.'),
  ('Industry', 'Agriculture & Food', 'Farming, crops, livestock, irrigation and food production.'),
  ('Industry', 'Marine & Ocean', 'Oceans, coasts, marine life and underwater systems.'),
  ('Industry', 'Sports & Recreation', 'Athletics, fitness, clubs and outdoor recreation.'),
  ('Industry', 'Aerospace & Space', 'Aircraft, rockets, satellites and planetary rovers.'),
  ('Industry', 'Energy', 'Electric power, renewables, nuclear power, and batteries at grid or vehicle scale.'),
  ('Industry', 'Accessibility', 'Tools for people with disabilities affecting vision, hearing, mobility or cognition.'),
  ('Industry', 'Forestry & Wood Products', 'Forests and their management, timber and wood products.'),
  ('Industry', 'Transportation', 'Vehicles, driving, traffic, cycling and rail.'),
  ('Industry', 'Community & Nonprofit', 'Volunteering, civic and public-sector services, and social good.'),
  ('Industry', 'Manufacturing & Industry', 'Factories, industrial operations, operator training and regulated industrial processes.'),
  ('Industry', 'Finance', 'Trading, banking and personal finance.'),
  ('Kind of work', 'Competition', 'Built for an external competition or a competition team.'),
  ('Kind of work', 'Research', 'A research group owns the question, and the deliverable is a result or a research prototype, not a product for users.'),
  ('Kind of work', 'Existing System', 'The team''s code goes into a codebase, product or device that already exists, including a rewrite of one, though a new app that only reads a sponsor''s API is New Build.'),
  ('Kind of work', 'New Build', 'Anything else built from scratch, such as a product, app, game or device.')
) AS v ("type", "name", "description")
ON CONFLICT ("domain", coalesce("type", ''), lower("name")) DO NOTHING;--> statement-breakpoint

-- Two live categories move into the new facets with their projects:
-- Technology: Web becomes Field: Web Development, and Type: Research becomes
-- Kind of work: Research. Links move by insert-then-delete, as in 0015,
-- rather than by renaming the row in place: a renamed row would have been
-- skipped by the insert above and kept no description, and the insert would
-- have failed outright had the target already existed.
--
-- The live rows are matched on lower(type) and lower(name), because the
-- unique index compares type exactly and nothing here can see how production
-- spelled it.
WITH moves ("from_type", "from_name", "to_type", "to_name") AS (
  VALUES
    ('technology', 'web', 'Field', 'web development'),
    ('type', 'research', 'Kind of work', 'research')
)
INSERT INTO "project_categories" ("project_id", "category_id")
SELECT pc."project_id", target."id"
FROM moves m
JOIN "categories" source
  ON source."domain" = 'project'
 AND lower(source."type") = m."from_type"
 AND lower(source."name") = m."from_name"
JOIN "project_categories" pc ON pc."category_id" = source."id"
JOIN "categories" target
  ON target."domain" = 'project'
 AND target."type" = m."to_type"
 AND lower(target."name") = m."to_name"
ON CONFLICT ("project_id", "category_id") DO NOTHING;--> statement-breakpoint

-- Kind of work replaces the Type facet, which answered three questions at
-- once: Consultancy is who the project is for, New Product or Game is where it
-- starts, and FOSS is a licence that holds for any of them. Their project
-- links cascade, and the categorization backfill gives each project left with
-- no category a Kind of work. Web and Research go too, their links already
-- moved above.
DELETE FROM "categories"
WHERE "domain" = 'project'
  AND (
    (lower("type") = 'technology' AND lower("name") = 'web')
    OR (
      lower("type") = 'type'
      AND lower("name") IN ('research', 'consultancy', 'foss', 'new product or game')
    )
  );
