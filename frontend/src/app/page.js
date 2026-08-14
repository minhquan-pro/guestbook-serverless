'use client';

import { useState, useEffect } from 'react';
import styles from './page.module.css';
import ThemeToggle from './ThemeToggle';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

export default function Home() {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    note: '',
  });
  const [submissions, setSubmissions] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Fetch submissions on page load
  useEffect(() => {
    async function fetchSubmissions() {
      try {
        const res = await fetch(`${API_URL}/submissions`);
        if (!res.ok) throw new Error('Không thể tải danh sách');
        const data = await res.json();
        setSubmissions(data.submissions || []);
      } catch (err) {
        console.error('Failed to fetch submissions:', err);
        setError('Không thể tải danh sách đăng ký');
      } finally {
        setIsLoading(false);
      }
    }
    fetchSubmissions();
  }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError('');

    try {
      const res = await fetch(`${API_URL}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || 'Đăng ký thất bại');
      }

      const data = await res.json();

      // Optimistic update — add new entry to the beginning of the list
      const newEntry = {
        submissionId: data.submissionId,
        name: formData.name,
        note: formData.note,
        status: 'RECEIVED',
      };
      setSubmissions((prev) => [newEntry, ...prev]);

      // Clear form
      setFormData({ name: '', email: '', note: '' });
    } catch (err) {
      setError(err.message || 'Đã xảy ra lỗi, vui lòng thử lại');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className={styles.container}>
      {/* Header */}
      <header className={styles.header}>
        <div className={styles.themeToggleWrap}>
          <ThemeToggle />
        </div>
        <h1 className={styles.title}>Guestbook</h1>
        <p className={styles.subtitle}>Đăng ký tham dự sự kiện</p>
      </header>

      {/* Two-Column Layout */}
      <div className={styles.grid}>
        {/* Left Column — Registration Form */}
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Đăng ký</h2>
          <form onSubmit={handleSubmit}>
            <div className={styles.formGroup}>
              <label htmlFor="name" className={styles.label}>
                Họ tên *
              </label>
              <input
                id="name"
                name="name"
                type="text"
                required
                className={styles.input}
                placeholder="Nhập họ tên"
                value={formData.name}
                onChange={handleChange}
              />
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="email" className={styles.label}>
                Email *
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                className={styles.input}
                placeholder="Nhập email"
                value={formData.email}
                onChange={handleChange}
              />
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="note" className={styles.label}>
                Ghi chú
              </label>
              <textarea
                id="note"
                name="note"
                className={styles.textarea}
                placeholder="Nhập ghi chú (tùy chọn)"
                value={formData.note}
                onChange={handleChange}
              />
            </div>

            {error && <p className={styles.error}>{error}</p>}

            <button
              type="submit"
              className={styles.submitBtn}
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Đang gửi...' : 'Đăng ký'}
            </button>
          </form>
        </section>

        {/* Right Column — Submissions List */}
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Danh sách đăng ký</h2>

          {isLoading ? (
            <div className={styles.loading}>Đang tải...</div>
          ) : submissions.length === 0 ? (
            <div className={styles.emptyState}>
              <p>Chưa có đăng ký nào</p>
            </div>
          ) : (
            <div className={styles.submissionsList}>
              {submissions.map((item) => (
                <div key={item.submissionId} className={styles.submissionRow}>
                  <span className={styles.submissionName}>{item.name}</span>
                  <span className={styles.submissionNote}>
                    {item.note || '—'}
                  </span>
                  <span className={styles.statusBadge}>{item.status}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
