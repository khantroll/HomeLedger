ALTER TABLE import_profiles ADD COLUMN date_order TEXT NOT NULL DEFAULT 'mdy' CHECK(date_order IN ('mdy','dmy'));
ALTER TABLE import_profiles ADD COLUMN number_format TEXT NOT NULL DEFAULT 'dot' CHECK(number_format IN ('dot','comma'));
