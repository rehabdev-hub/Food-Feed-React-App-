import "./About.css";

function About() {
  return (
    <div className="about-page">
      <section className="about-intro">
        <h1>About Us</h1>
        <p>
          Welcome to <span className="highlight">My Project</span>.  
          We are passionate about delivering top-notch web solutions, mobile apps,  
          and digital experiences that empower businesses to grow in the modern world.
        </p>
      </section>

      {/* Mission & Vision */}
      <section className="about-grid">
        <div className="about-card">
          <h2>Our Mission</h2>
          <p>
            To craft high-quality digital products that combine innovation,  
            functionality, and modern design to help our clients achieve success.
          </p>
        </div>
        <div className="about-card">
          <h2>Our Vision</h2>
          <p>
            To become a trusted global leader in digital solutions, recognized  
            for creativity, innovation, and sustainable growth.
          </p>
        </div>
      </section>

      <section className="about-form">
        <h2>Get in Touch</h2>
        <form>
          <label>Name</label>
          <input type="text" placeholder="Enter your name" />

          <label>Email</label>
          <input type="email" placeholder="Enter your email" />

          <label>Message</label>
          <textarea rows="4" placeholder="Write your message..."></textarea>

          <button type="submit">Send Message</button>
        </form>
      </section>
    </div>
  );
}

export { About };
